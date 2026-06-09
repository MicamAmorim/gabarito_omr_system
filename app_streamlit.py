""" from __future__ import annotations

import json
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path

import pandas as pd
import streamlit as st

from omr_corrector_overlay import process

st.set_page_config(page_title="Corretor de gabaritos", layout="wide")
st.title("Corretor de gabaritos escaneados")

st.markdown("Cadastre o gabarito, os intervalos de matérias e envie um PDF/imagens escaneadas em lote.")

with st.sidebar:
    st.header("Configuração")
    num_questions = st.number_input("Número de questões", min_value=1, max_value=100, value=60)
    alternatives = [x.strip().upper() for x in st.text_input("Alternativas", value="A,B,C,D,E").split(",") if x.strip()]
    min_fill = st.slider("Sensibilidade da marcação", min_value=0.20, max_value=0.80, value=0.42, step=0.01)
    min_margin = st.slider("Margem mínima entre alternativas", min_value=0.00, max_value=0.40, value=0.10, step=0.01)

st.subheader("1. Gabarito")
raw_answers = st.text_area(
    "Cole as respostas em sequência ou no formato 1:A,2:B...",
    value="ABCDE" * int((num_questions + 4) // 5),
    height=120,
)

def (raw: str, n: int):
    raw = raw.strip().upper().replace(";", ",")
    ans = {}
    if ":" in raw:
        for part in raw.split(","):
            if not part.strip():
                continue
            q, a = part.split(":", 1)
            ans[str(int(q.strip()))] = a.strip()[0]
    else:
        seq = [c for c in raw if c.isalpha()]
        for i, a in enumerate(seq[:n], start=1):
            ans[str(i)] = a
    return ans

answers = parse_answers(raw_answers, int(num_questions))
st.write(f"Respostas cadastradas: {len(answers)}")

st.subheader("2. Matérias e intervalos")
subjects_df = st.data_editor(
    pd.DataFrame([
        {"name": "História", "start": 1, "end": 20},
        {"name": "Geografia", "start": 21, "end": 40},
        {"name": "Filosofia/Sociologia", "start": 41, "end": 60},
    ]),
    num_rows="dynamic",
    use_container_width=True,
)

uploaded = st.file_uploader("3. Envie o PDF ou imagem", type=["pdf", "png", "jpg", "jpeg", "tif", "tiff"], accept_multiple_files=False)
debug = st.checkbox("Gerar imagens de conferência", value=True)

if uploaded and st.button("Corrigir"):
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        in_path = td / uploaded.name
        in_path.write_bytes(uploaded.getbuffer())
        cfg = {
            "exam_name": "Prova",
            "num_questions": int(num_questions),
            "alternatives": alternatives,
            "answers": answers,
            "subjects": subjects_df.to_dict(orient="records"),
            "reading": {"min_fill": float(min_fill), "min_margin": float(min_margin), "allow_multiple": False},
        }
        cfg_path = td / "config.json"
        cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        out_dir = td / "saida"
        summary, details = process(in_path, cfg_path, out_dir, debug=debug)
        st.success("Correção concluída.")
        st.subheader("Resumo")
        st.dataframe(summary, use_container_width=True)
        st.subheader("Leitura por questão")
        st.dataframe(details, use_container_width=True)
        xlsx = out_dir / "resultado_gabaritos.xlsx"
        st.download_button("Baixar Excel", data=xlsx.read_bytes(), file_name="resultado_gabaritos.xlsx") """

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
import zipfile
from io import BytesIO
import pandas as pd
import streamlit as st

from omr_corrector_overlay_linhas_atualizado import process

st.set_page_config(page_title="Corretor de gabaritos", layout="wide")
st.title("Corretor de gabaritos escaneados")

st.markdown(
    "Cadastre o gabarito, os intervalos de matérias e envie um PDF/imagens escaneadas em lote."
)

with st.sidebar:
    st.header("Configuração")
    num_questions = st.number_input(
        "Número de questões",
        min_value=1,
        max_value=100,
        value=60,
    )

    alternatives = [
        x.strip().upper()
        for x in st.text_input("Alternativas", value="A,B,C,D,E").split(",")
        if x.strip()
    ]

    min_fill = st.slider(
        "Sensibilidade da marcação",
        min_value=0.20,
        max_value=0.80,
        value=0.42,
        step=0.01,
    )

    min_margin = st.slider(
        "Margem mínima entre alternativas",
        min_value=0.00,
        max_value=0.40,
        value=0.10,
        step=0.01,
    )

st.subheader("1. Gabarito")

raw_answers = st.text_area(
    "Cole as respostas em sequência ou no formato 1:A,2:B...",
    value="ABCDE" * int((num_questions + 4) // 5),
    height=120,
)


def parse_answers(raw: str, n: int) -> dict[str, str]:
    raw = raw.strip().upper().replace(";", ",")
    ans: dict[str, str] = {}

    if ":" in raw:
        for part in raw.split(","):
            if not part.strip():
                continue

            q, a = part.split(":", 1)
            ans[str(int(q.strip()))] = a.strip()[0]
    else:
        seq = [c for c in raw if c.isalpha()]
        for i, a in enumerate(seq[:n], start=1):
            ans[str(i)] = a

    return ans

def zip_folder_to_memory(folder: Path, root_name: str = "debug") -> bytes:
    buffer = BytesIO()

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_path in sorted(folder.rglob("*")):
            if file_path.is_file():
                arcname = Path(root_name) / file_path.relative_to(folder)
                zip_file.write(file_path, arcname.as_posix())

    buffer.seek(0)
    return buffer.getvalue()


answers = parse_answers(raw_answers, int(num_questions))
st.write(f"Respostas cadastradas: {len(answers)}")

st.subheader("2. Matérias e intervalos")

subjects_df = st.data_editor(
    pd.DataFrame(
        [
            {"name": "História", "start": 1, "end": 20},
            {"name": "Geografia", "start": 21, "end": 40},
            {"name": "Filosofia/Sociologia", "start": 41, "end": 60},
        ]
    ),
    num_rows="dynamic",
    width="stretch",
)

uploaded = st.file_uploader(
    "3. Envie o PDF ou imagem",
    type=["pdf", "png", "jpg", "jpeg", "tif", "tiff"],
    accept_multiple_files=False,
)

debug = st.checkbox("Gerar imagens de conferência", value=True)

if uploaded and st.button("Corrigir"):
    base_dir = Path("resultados_streamlit")
    base_dir.mkdir(exist_ok=True)

    safe_name = Path(uploaded.name).stem
    run_name = f"{safe_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    work_dir = base_dir / run_name
    work_dir.mkdir(parents=True, exist_ok=True)

    in_path = work_dir / uploaded.name
    in_path.write_bytes(uploaded.getbuffer())

    cfg = {
        "exam_name": "Prova",
        "num_questions": int(num_questions),
        "alternatives": alternatives,
        "answers": answers,
        "subjects": subjects_df.to_dict(orient="records"),
        "reading": {
            "min_fill": float(min_fill),
            "min_margin": float(min_margin),
            "allow_multiple": False,
        },
    }

    cfg_path = work_dir / "config.json"
    cfg_path.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    out_dir = work_dir / "saida"

    summary, details = process(
        in_path,
        cfg_path,
        out_dir,
        debug=debug,
    )

    st.success("Correção concluída.")

    st.write("Arquivos salvos em:")
    st.code(str(out_dir.resolve()))

    st.subheader("Resumo")
    st.dataframe(summary, width="stretch")

    st.subheader("Leitura por questão")
    st.dataframe(details, width="stretch")

    xlsx = out_dir / "resultado_gabaritos.xlsx"

    if xlsx.exists():
        st.download_button(
            "Baixar Excel",
            data=xlsx.read_bytes(),
            file_name="resultado_gabaritos.xlsx",
        )

    debug_dir = out_dir / "debug"

    if debug and debug_dir.exists():
        debug_files = [p for p in debug_dir.rglob("*") if p.is_file()]

        if debug_files:
            debug_zip = zip_folder_to_memory(debug_dir, root_name="debug")

            st.download_button(
                "Baixar ZIP da pasta debug",
                data=debug_zip,
                file_name=f"debug_{run_name}.zip",
                mime="application/zip",
            )

    if debug:
        st.subheader("Imagens de conferência")

        if debug_dir.exists():
            debug_images = sorted(debug_dir.glob("*.jpg"))

            if debug_images:
                st.write(f"Total de imagens geradas: {len(debug_images)}")

                for img_path in debug_images[:10]:
                    st.image(
                        str(img_path),
                        caption=img_path.name,
                        width="stretch",
                    )

                if len(debug_images) > 10:
                    st.info(
                        "Mostrando apenas as 10 primeiras imagens. "
                        "As demais estão salvas na pasta debug."
                    )
            else:
                st.warning("Nenhuma imagem de conferência foi encontrada na pasta debug.")
        else:
            st.warning("A pasta debug não foi criada.")
