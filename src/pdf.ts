// pdf.js bağlayıcısı. "legacy" derleme eski Android WebView'larda da çalışır.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker";
import { UserError, assertPdfFile } from "./lib/errors.ts";
import { extractFromDocument } from "./lib/extract.ts";
import type { ExtractResult } from "./lib/extract.ts";

let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

export type AskPassword = (wasIncorrect: boolean) => Promise<string | null>;

export type OpenedPdf = { doc: PDFDocumentProxy; encrypted: boolean };

/** PDF'i açar. Parola gerekirse `askPassword` ile kullanıcıdan istenir. */
export async function openPdf(blob: Blob, askPassword: AskPassword): Promise<OpenedPdf> {
  ensureWorker();
  const data = new Uint8Array(await blob.arrayBuffer()); // işçiye aktarılır; her açışta yeni kopya
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  let encrypted = false;
  let cancelled = false;

  task.onPassword = (update: (password: string) => void, reason: number) => {
    encrypted = true;
    void askPassword(reason === 2).then((password) => {
      if (password === null) {
        cancelled = true;
        void task.destroy();
      } else {
        update(password);
      }
    });
  };

  try {
    const doc = await task.promise;
    return { doc, encrypted };
  } catch (e) {
    if (cancelled) throw new UserError("Parola girilmedi; PDF açılmadı.", "PASSWORD_CANCELLED");
    throw e;
  }
}

export async function importPdf(
  file: File,
  opts: { askPassword: AskPassword; onProgress?: (done: number, total: number) => void; signal?: AbortSignal }
): Promise<ExtractResult & { encrypted: boolean }> {
  assertPdfFile(file);
  const { doc, encrypted } = await openPdf(file, opts.askPassword);
  try {
    const result = await extractFromDocument(doc, { onProgress: opts.onProgress, signal: opts.signal });
    return { ...result, encrypted };
  } finally {
    await doc.destroy();
  }
}

/** Seçili sayfayı kanvasa çizer (istek üzerine; içe aktarmada görsel üretilmez). */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number
): Promise<{ cancel: () => void; done: Promise<void> }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new UserError("Sayfa görseli çizilemedi.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: context, viewport });
  return {
    cancel: () => task.cancel(),
    done: task.promise.then(() => {
      page.cleanup();
    })
  };
}
