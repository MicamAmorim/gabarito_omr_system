from __future__ import annotations

import argparse
import csv
import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import cv2
import fitz  # PyMuPDF
import numpy as np
import pandas as pd

ALT_DEFAULT = ["A", "B", "C", "D", "E"]
CANON_W, CANON_H = 1000, 1414


@dataclass
class BubbleRead:
    question: int
    selected: str
    confidence: float
    fill_by_alt: Dict[str, float]
    status: str


@dataclass
class PageResult:
    source_file: str
    page: int
    qr_data: str
    alignment_ok: bool
    layout_ok: bool
    reads: List[BubbleRead]
    scores: Dict[str, Any]


def load_config(path: str | Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    cfg.setdefault("alternatives", ALT_DEFAULT)
    cfg.setdefault("reading", {})
    cfg["reading"].setdefault("min_fill", 0.42)
    cfg["reading"].setdefault("min_margin", 0.10)
    cfg["reading"].setdefault("allow_multiple", False)
    return cfg


def iter_pages(input_path: str | Path, dpi: int = 220) -> Iterable[Tuple[np.ndarray, int, str]]:
    """Yield BGR images from a PDF or from an image file/folder."""
    input_path = Path(input_path)
    files: List[Path]
    if input_path.is_dir():
        files = sorted([p for p in input_path.iterdir() if p.suffix.lower() in {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}])
    else:
        files = [input_path]

    for file in files:
        if file.suffix.lower() == ".pdf":
            doc = fitz.open(str(file))
            zoom = dpi / 72.0
            matrix = fitz.Matrix(zoom, zoom)
            for i, page in enumerate(doc, start=1):
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
                yield cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), i, str(file)
        else:
            img = cv2.imread(str(file), cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError(f"Não consegui ler a imagem: {file}")
            yield img, 1, str(file)


def threshold_dark(gray: np.ndarray) -> np.ndarray:
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    # Otsu é bom nos scans do modelo, mas adaptive ajuda quando há sombra.
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return otsu


def _square_candidates(binary_inv: np.ndarray, min_area: float, max_area: float) -> List[Tuple[int, int, int, int, float, float]]:
    contours, _ = cv2.findContours(binary_inv, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = cv2.contourArea(c)
        if not (min_area <= area <= max_area):
            continue
        ratio = w / max(h, 1)
        extent = area / max(w * h, 1)
        if 0.70 <= ratio <= 1.30 and extent >= 0.72:
            out.append((x, y, w, h, area, extent))
    return out


def find_corner_markers(img_bgr: np.ndarray) -> Optional[np.ndarray]:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    binv = threshold_dark(gray)
    H, W = binv.shape
    area_page = W * H
    candidates = _square_candidates(binv, area_page * 0.00015, area_page * 0.006)
    centers = []
    for x, y, w, h, area, extent in candidates:
        cx, cy = x + w / 2, y + h / 2
        # Os fiduciais ficam nas margens, não na região central de respostas.
        if (cx < W * 0.22 or cx > W * 0.78) and (cy < H * 0.22 or cy > H * 0.78):
            centers.append((cx, cy, x, y, w, h))
    if len(centers) < 4:
        return None

    targets = np.array([[0, 0], [W, 0], [W, H], [0, H]], dtype=np.float32)
    pts = []
    used = set()
    for tx, ty in targets:
        best_idx, best_d = None, 1e18
        for idx, (cx, cy, *_rest) in enumerate(centers):
            if idx in used:
                continue
            d = (cx - tx) ** 2 + (cy - ty) ** 2
            if d < best_d:
                best_idx, best_d = idx, d
        if best_idx is None:
            return None
        used.add(best_idx)
        pts.append([centers[best_idx][0], centers[best_idx][1]])
    return np.array(pts, dtype=np.float32)  # tl, tr, br, bl


def align_page(img_bgr: np.ndarray) -> Tuple[np.ndarray, bool, Optional[np.ndarray]]:
    markers = find_corner_markers(img_bgr)
    if markers is None:
        return cv2.resize(img_bgr, (CANON_W, CANON_H)), False, None
    dst = np.array([[45, 45], [CANON_W - 45, 45], [CANON_W - 45, CANON_H - 45], [45, CANON_H - 45]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(markers, dst)
    warped = cv2.warpPerspective(img_bgr, M, (CANON_W, CANON_H), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))
    return warped, True, M


def cluster_1d(values: List[float], tol: float) -> List[float]:
    if not values:
        return []
    values = sorted(values)
    clusters = [[values[0]]]
    for v in values[1:]:
        if abs(v - np.mean(clusters[-1])) <= tol:
            clusters[-1].append(v)
        else:
            clusters.append([v])
    return [float(np.mean(c)) for c in clusters]


def detect_layout(warped_bgr: np.ndarray, num_questions: int, alternatives: List[str]) -> Tuple[Dict[int, Dict[str, Tuple[float, float]]], bool, Dict[str, Any]]:
    """Detect rows and option columns using the black guide squares printed on the answer sheet.

    No modelo analisado, há uma coluna vertical de guias à esquerda do primeiro bloco,
    que fornece as 20 linhas. Na base de cada bloco há uma sequência de quadrados
    pretos alinhados com as alternativas A-E. Assim, a leitura continua funcionando
    mesmo com leve rotação/distorção após a homografia dos cantos.
    """
    gray = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)
    binv = threshold_dark(gray)
    H, W = binv.shape

    candidates = _square_candidates(binv, 55, 1600)
    guide = []
    for x, y, w, h, area, extent in candidates:
        cx, cy = x + w / 2, y + h / 2
        # Área dos gabaritos. Evita QR code e cabeçalho.
        if cy > H * 0.48 and 7 <= w <= 36 and 7 <= h <= 36 and extent >= 0.80:
            guide.append((cx, cy, x, y, w, h, area))

    debug = {"guide_count": len(guide), "row_source_x": None, "bottom_groups": [], "blocks": []}

    # 1) Linhas: procura a coluna vertical com ~20 quadradinhos impressos.
    x_clusters = cluster_1d([g[0] for g in guide if H * 0.50 < g[1] < H * 0.90], tol=8)
    row_ys: List[float] = []
    best_x, best_count = None, 0
    for xc in x_clusters:
        ys = [g[1] for g in guide if abs(g[0] - xc) <= 10 and H * 0.50 < g[1] < H * 0.90]
        if len(ys) > best_count and (len(ys) >= 12):
            best_count = len(ys)
            best_x = xc
            row_ys = cluster_1d(sorted(ys), tol=5)
    if len(row_ys) > 20:
        row_ys = row_ys[:20]
    debug["row_source_x"] = best_x

    # Fallback: caso os quadradinhos laterais não sejam detectados, usa a geometria do modelo.
    if len(row_ys) < 20:
        row_ys = list(np.linspace(H * 0.538, H * 0.875, 20))

    # 2) Colunas de alternativas: sequências de 5 quadradinhos na base de cada bloco.
    bottom = sorted([g for g in guide if g[1] > H * 0.88], key=lambda g: g[0])
    groups: List[List[Tuple[float, float, int, int, int, int, float]]] = []
    for g in bottom:
        if not groups or abs(g[0] - groups[-1][-1][0]) > 48:
            groups.append([g])
        else:
            groups[-1].append(g)
    groups = [grp for grp in groups if len(grp) >= len(alternatives)]
    groups = groups[: math.ceil(num_questions / 20)]

    positions: Dict[int, Dict[str, Tuple[float, float]]] = {}
    for b, grp in enumerate(groups):
        start_q = b * 20 + 1
        if start_q > num_questions:
            break
        end_q = min(start_q + 19, num_questions)
        xs = sorted([g[0] for g in grp])
        # Mantém as cinco primeiras posições do grupo; no modelo são A-E.
        alt_xs = xs[: len(alternatives)]
        debug["bottom_groups"].append([round(x, 1) for x in xs])
        debug["blocks"].append({"start": start_q, "end": end_q, "rows": len(row_ys), "alt_xs": alt_xs})
        for local_idx, q in enumerate(range(start_q, end_q + 1)):
            y = row_ys[local_idx]
            positions[q] = {alt: (alt_xs[i], y) for i, alt in enumerate(alternatives)}

    layout_ok = len(positions) >= num_questions
    return positions, layout_ok, debug

def read_bubbles(warped_bgr: np.ndarray, positions: Dict[int, Dict[str, Tuple[float, float]]], cfg: Dict[str, Any]) -> List[BubbleRead]:
    alternatives = cfg.get("alternatives", ALT_DEFAULT)
    gray = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)
    # Normalização local melhora scans claros/escuros.
    gray = cv2.medianBlur(gray, 3)
    binv = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 9)

    min_fill = float(cfg["reading"].get("min_fill", 0.42))
    min_margin = float(cfg["reading"].get("min_margin", 0.10))
    allow_multiple = bool(cfg["reading"].get("allow_multiple", False))
    reads: List[BubbleRead] = []

    for q in sorted(positions):
        fills: Dict[str, float] = {}
        for alt, (cx, cy) in positions[q].items():
            # Disco central: evita confundir aro da bolha e letra impressa com marcação.
            r = 11
            mask = np.zeros_like(binv, dtype=np.uint8)
            cv2.circle(mask, (int(round(cx)), int(round(cy))), r, 255, -1)
            vals = binv[mask == 255]
            fills[alt] = float(np.mean(vals) / 255.0) if vals.size else 0.0

        ordered = sorted(fills.items(), key=lambda kv: kv[1], reverse=True)
        best_alt, best_fill = ordered[0]
        second_fill = ordered[1][1] if len(ordered) > 1 else 0.0
        confidence = max(0.0, min(1.0, best_fill - second_fill))

        marked = [alt for alt, fill in fills.items() if fill >= min_fill]
        if not marked:
            selected, status = "", "blank"
        elif len(marked) > 1 and not allow_multiple:
            selected, status = "/".join(marked), "multiple"
        elif best_fill < min_fill or (best_fill - second_fill) < min_margin:
            selected, status = best_alt, "low_confidence"
        else:
            selected, status = best_alt, "ok"
        reads.append(BubbleRead(q, selected, confidence, fills, status))
    return reads


def read_qr(warped_bgr: np.ndarray) -> str:
    try:
        detector = cv2.QRCodeDetector()
        data, _points, _ = detector.detectAndDecode(warped_bgr)
        return data or ""
    except Exception:
        return ""


def score_page(reads: List[BubbleRead], cfg: Dict[str, Any]) -> Dict[str, Any]:
    answers = {int(k): str(v).upper().strip() for k, v in cfg.get("answers", {}).items()}
    selected = {r.question: r.selected for r in reads}
    total_correct = 0
    total_valid = 0
    by_subject = {}

    for subject in cfg.get("subjects", []):
        name = subject["name"]
        start, end = int(subject["start"]), int(subject["end"])
        correct = 0
        answered = 0
        invalid = 0
        for q in range(start, end + 1):
            if q not in answers:
                continue
            total_valid += 1
            sel = selected.get(q, "")
            read_status = next((r.status for r in reads if r.question == q), "missing")
            if read_status in {"multiple", "blank", "missing"}:
                invalid += 1
            else:
                answered += 1
                if sel == answers[q]:
                    correct += 1
                    total_correct += 1
        n = sum(1 for q in range(start, end + 1) if q in answers)
        by_subject[name] = {
            "questions": n,
            "correct": correct,
            "answered": answered,
            "blank_or_invalid": invalid,
            "score_percent": round(100 * correct / n, 2) if n else 0.0,
        }

    return {
        "total_questions": total_valid,
        "total_correct": total_correct,
        "total_percent": round(100 * total_correct / total_valid, 2) if total_valid else 0.0,
        "subjects": by_subject,
    }


def make_debug_overlay(warped_bgr: np.ndarray, positions: Dict[int, Dict[str, Tuple[float, float]]], reads: List[BubbleRead]) -> np.ndarray:
    out = warped_bgr.copy()
    read_by_q = {r.question: r for r in reads}

    for q, alts in positions.items():
        r = read_by_q.get(q)
        if r is None:
            continue

        if r.selected:
            selected_alts = [item.strip() for item in str(r.selected).split("/") if item.strip()]
        else:
            selected_alts = [max(r.fill_by_alt, key=r.fill_by_alt.get)]

        selected_alts = [item.strip() for item in str(r.selected).split("/") if item.strip()]
        for alt in selected_alts:
            if alt not in alts:
                continue

            cx, cy = alts[alt]
            center = (int(round(cx)), int(round(cy)))
            radius = 12

            # Bolinha preta preenchida.
            cv2.circle(out, center, radius, (0, 0, 0), -1)

            # Letra vermelha centralizada dentro da bolinha.
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.42
            thickness = 1
            (tw, th), baseline = cv2.getTextSize(alt, font, font_scale, thickness)
            tx = center[0] - tw // 2
            ty = center[1] + th // 2
            cv2.putText(out, alt, (tx, ty), font, font_scale, (0, 0, 255), thickness, cv2.LINE_AA)

    return out


def save_image(path: str | Path, image: np.ndarray) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    ext = path.suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png"}:
        ext = ".jpg"

    ok, buffer = cv2.imencode(ext, image)

    if not ok:
        raise RuntimeError(f"Não consegui codificar a imagem: {path}")

    buffer.tofile(str(path))

def process(input_path: str | Path, config_path: str | Path, output_dir: str | Path, dpi: int = 220, debug: bool = False) -> Tuple[pd.DataFrame, pd.DataFrame]:
    cfg = load_config(config_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    debug_dir = output_dir / "debug"
    debug_dir.mkdir(parents=True, exist_ok=True)

    summary_rows = []
    detail_rows = []
    num_questions = int(cfg.get("num_questions", len(cfg.get("answers", {}))))
    alternatives = cfg.get("alternatives", ALT_DEFAULT)

    for img, page, src in iter_pages(input_path, dpi=dpi):
        warped, align_ok, _M = align_page(img)
        positions, layout_ok, layout_debug = detect_layout(warped, num_questions, alternatives)
        reads = read_bubbles(warped, positions, cfg)
        qr = read_qr(warped)
        scores = score_page(reads, cfg)

        record_id = qr if qr else f"{Path(src).stem}_p{page:03d}"
        row = {
            "record_id": record_id,
            "source_file": src,
            "page": page,
            "alignment_ok": align_ok,
            "layout_ok": layout_ok,
            "total_correct": scores["total_correct"],
            "total_questions": scores["total_questions"],
            "total_percent": scores["total_percent"],
        }
        for subj, data in scores["subjects"].items():
            row[f"{subj}_correct"] = data["correct"]
            row[f"{subj}_questions"] = data["questions"]
            row[f"{subj}_percent"] = data["score_percent"]
        summary_rows.append(row)

        ans_key = {int(k): str(v).upper().strip() for k, v in cfg.get("answers", {}).items()}
        for r in reads:
            correct_alt = ans_key.get(r.question, "")
            detail_rows.append({
                "record_id": record_id,
                "source_file": src,
                "page": page,
                "question": r.question,
                "selected": r.selected,
                "correct": correct_alt,
                "is_correct": bool(r.selected == correct_alt and r.status in {"ok", "low_confidence"}),
                "status": r.status,
                "confidence": round(r.confidence, 4),
                **{f"fill_{a}": round(r.fill_by_alt.get(a, 0), 4) for a in alternatives},
            })

        if debug:
            overlay = make_debug_overlay(warped, positions, reads)

            debug_img_path = debug_dir / f"{Path(src).stem}_p{page:03d}_debug.jpg"
            aligned_path = debug_dir / f"{Path(src).stem}_p{page:03d}_aligned.jpg"

            save_image(debug_img_path, overlay)
            save_image(aligned_path, warped)

            with open(debug_dir / f"{Path(src).stem}_p{page:03d}.layout.json", "w", encoding="utf-8") as f:
                json.dump(
                    {"align_ok": align_ok, "layout_ok": layout_ok, **layout_debug},
                    f,
                    ensure_ascii=False,
                    indent=2,
                )

    summary = pd.DataFrame(summary_rows)
    details = pd.DataFrame(detail_rows)
    summary.to_csv(output_dir / "resumo_notas.csv", index=False, encoding="utf-8-sig")
    details.to_csv(output_dir / "leituras_questoes.csv", index=False, encoding="utf-8-sig")
    with pd.ExcelWriter(output_dir / "resultado_gabaritos.xlsx", engine="openpyxl") as writer:
        summary.to_excel(writer, sheet_name="Resumo", index=False)
        details.to_excel(writer, sheet_name="Questoes", index=False)
    return summary, details


def main() -> None:
    parser = argparse.ArgumentParser(description="Leitor/corretor OMR para gabaritos escaneados em lote.")
    parser.add_argument("input", help="PDF, imagem ou pasta com PDFs/imagens")
    parser.add_argument("--config", required=True, help="Arquivo JSON com gabarito e intervalos de matérias")
    parser.add_argument("--out", default="resultados_omr", help="Pasta de saída")
    parser.add_argument("--dpi", type=int, default=220, help="DPI para renderizar PDFs")
    parser.add_argument("--debug", action="store_true", help="Gera imagens com círculos sobre as bolhas lidas")
    args = parser.parse_args()
    summary, _details = process(args.input, args.config, args.out, dpi=args.dpi, debug=args.debug)
    print(f"Processado: {len(summary)} páginas. Saída em: {args.out}")


if __name__ == "__main__":
    main()
