// Prints selected pages using original PDF content and the "print" intent into a
// hidden container that only becomes visible in the print media (see styles.css).
import { AnnotationMode, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";

const CONTAINER_ID = "print-container";
// Refuse oversized jobs instead of silently lowering print resolution. This
// bounds retained decoded page rasters; the renderer uses one working canvas.
const MAX_TOTAL_PIXELS = 128 * 1024 * 1024;
const MAX_PAGE_PIXELS = 16 * 1024 * 1024;
const MAX_CANVAS_DIMENSION = 8192;

export class PrintBudgetError extends Error {}

export function printScale(width: number, height: number, dpi = 150): number {
  if (!(width > 0 && height > 0 && Number.isFinite(width * height))) throw new Error("Invalid page size");
  return Math.min(
    dpi / 72,
    Math.sqrt(MAX_PAGE_PIXELS / (width * height)),
    MAX_PAGE_PIXELS / Math.max(width, height),
    MAX_CANVAS_DIMENSION / width,
    MAX_CANVAS_DIMENSION / height,
  );
}

export interface PrintOptions {
  pages?: readonly number[];
  dpi?: 150 | 300;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed")))),
  );
}

function loadImage(img: HTMLImageElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Print page image failed to load"));
    img.src = url;
  });
}

/**
 * Renders the selected pages for printing. Resolves to a function that opens the system
 * print dialog, or null when the job was cancelled.
 */
export async function printDocument(
  doc: PDFDocumentProxy,
  options: PrintOptions = {},
): Promise<(() => void) | null> {
  const { onProgress, signal, dpi = 150 } = options;
  const pages = options.pages ? [...options.pages] : Array.from({ length: doc.numPages }, (_, index) => index + 1);
  if (!pages.length || new Set(pages).size !== pages.length ||
      pages.some((page) => !Number.isInteger(page) || page < 1 || page > doc.numPages)) throw new Error("Invalid print pages");
  if (dpi !== 150 && dpi !== 300) throw new Error("Invalid print resolution");
  // Preflight only selected pages. No canvas work occurs for rejected jobs.
  let totalPixels = 0;
  for (const pageNumber of pages) {
    if (signal?.aborted) return null;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const scale = printScale(viewport.width, viewport.height, dpi);
    totalPixels += Math.max(1, Math.floor(viewport.width * scale)) * Math.max(1, Math.floor(viewport.height * scale));
    if (totalPixels > MAX_TOTAL_PIXELS) throw new PrintBudgetError("Choose a smaller page range or print in separate jobs. Print quality was not reduced.");
  }
  document.getElementById(CONTAINER_ID)?.remove();
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  const pageStyle = document.createElement("style");
  const canvas = document.createElement("canvas");
  let renderTask: RenderTask | null = null;
  const cancelRender = () => renderTask?.cancel();
  signal?.addEventListener("abort", cancelRender, { once: true });
  const urls: string[] = [];
  // One named @page rule per distinct page size, so mixed portrait/landscape documents print correctly.
  const pageRules = new Map<string, string>();
  const cleanup = () => {
    container.remove();
    pageStyle.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
  };

  try {
    const printAnnotationStorage = doc.annotationStorage.print;
    let done = 0;
    for (const pageNumber of pages) {
      if (signal?.aborted) {
        cleanup();
        return null;
      }
      const page = await doc.getPage(pageNumber);
      if (signal?.aborted) {
        cleanup();
        return null;
      }
      const viewport = page.getViewport({ scale: 1 });
      const scale = printScale(viewport.width, viewport.height, dpi);
      const size = `${viewport.width}pt ${viewport.height}pt`;
      if (!pageRules.has(size)) {
        const name = `openpdf-size-${pageRules.size + 1}`;
        pageRules.set(size, name);
        // The first size is also the default for engines without named-page support.
        pageStyle.textContent +=
          (pageRules.size === 1 ? `@page { size: ${size}; margin: 0; }
` : "") +
          `@page ${name} { size: ${size}; margin: 0; }
`;
      }
      canvas.width = Math.max(1, Math.floor(viewport.width * scale));
      canvas.height = Math.max(1, Math.floor(viewport.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is not available");
      context.save();
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
      renderTask = page.render({
        canvas,
        transform: [scale, 0, 0, scale, 0, 0],
        viewport,
        intent: "print",
        annotationMode: AnnotationMode.ENABLE_STORAGE,
        printAnnotationStorage,
      });
      await renderTask.promise;
      renderTask = null;
      const url = URL.createObjectURL(await canvasToBlob(canvas));
      urls.push(url);
      const wrapper = document.createElement("div");
      wrapper.className = "print-page";
      wrapper.style.cssText = `page: ${pageRules.get(size)}; width: ${viewport.width}pt; height: ${viewport.height}pt;`;
      const img = document.createElement("img");
      await loadImage(img, url);
      if (signal?.aborted) { cleanup(); return null; }
      wrapper.append(img);
      container.append(wrapper);
      page.cleanup();
      onProgress?.(++done, pages.length);
    }
    if (signal?.aborted) {
      cleanup();
      return null;
    }
    document.head.append(pageStyle);
    document.body.append(container);
    return () => {
      window.addEventListener("afterprint", cleanup, { once: true });
      try {
        window.print();
      } catch (error) {
        window.removeEventListener("afterprint", cleanup);
        cleanup();
        throw error;
      }
    };
  } catch (error) {
    cleanup();
    if (signal?.aborted) return null;
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelRender);
    canvas.width = canvas.height = 0;
  }
}
