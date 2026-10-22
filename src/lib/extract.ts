// PDF belgesinden sayfa sayfa metin çıkarır. pdf.js'e doğrudan bağlı değildir:
// yalnızca numPages/getPage arayüzüne ihtiyaç duyar (testte sahte belge verilir).

import { MAX_PDF_PAGES, UserError } from "./errors.ts";
import { itemsToParagraphs } from "./pdfText.ts";
import { countWords } from "./text.ts";
import type { PageContent } from "./text.ts";

export type PdfPageLike = {
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup(): void;
};
export type PdfDocLike = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
};

export type ExtractResult = {
  pages: PageContent[];
  scannedPages: number;
  wordCount: number;
};

export async function extractFromDocument(
  doc: PdfDocLike,
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}
): Promise<ExtractResult> {
  const total = doc.numPages;
  if (!total) throw new UserError("Bu PDF'de hiç sayfa yok.", "NO_PAGES");
  if (total > MAX_PDF_PAGES) {
    throw new UserError(`PDF çok uzun (${MAX_PDF_PAGES} sayfa üzeri). Bölümlere ayırıp tekrar dene.`, "TOO_MANY_PAGES");
  }

  const pages: PageContent[] = [];
  let scannedPages = 0;
  let wordCount = 0;

  for (let n = 1; n <= total; n++) {
    if (opts.signal?.aborted) throw new UserError("İçe aktarma iptal edildi.", "CANCELLED");
    const page = await doc.getPage(n);
    try {
      const content = await page.getTextContent();
      const paragraphs = itemsToParagraphs(content.items);
      if (!paragraphs.length) scannedPages++;
      for (const p of paragraphs) wordCount += countWords(p.text);
      pages.push({ page: n, paragraphs });
    } finally {
      page.cleanup();
    }
    opts.onProgress?.(n, total);
    if (n % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0)); // arayüze nefes aldır
  }

  if (scannedPages === total) {
    throw new UserError(
      "Bu PDF'den seçilebilir metin çıkarılamadı. Dosya taranmış veya görsel tabanlı olabilir; bu sürümde OCR yok.",
      "NO_TEXT"
    );
  }
  return { pages, scannedPages, wordCount };
}
