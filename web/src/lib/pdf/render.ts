export interface RenderedPdfPage {
  pageNumber: number;
  canvas: HTMLCanvasElement;
}

export async function renderPdfPages(file: File, maxDimension = 1800): Promise<RenderedPdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: RenderedPdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, maxDimension / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Não consegui preparar a página do PDF para leitura.");

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    pages.push({ pageNumber, canvas });
    page.cleanup();
  }

  await doc.destroy();
  return pages;
}
