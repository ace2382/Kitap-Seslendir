import { describe, expect, it } from "vitest";
import { extractFromDocument } from "./extract.ts";
import type { PdfDocLike } from "./extract.ts";
import { UserError } from "./errors.ts";

const line = (str: string, y: number) => ({ str, transform: [12, 0, 0, 12, 50, y], width: str.length * 6, height: 12 });

function fakeDoc(pageItems: unknown[][]): PdfDocLike & { cleaned: number } {
  const doc: PdfDocLike & { cleaned: number } = {
    cleaned: 0,
    numPages: pageItems.length,
    async getPage(n: number) {
      return {
        getTextContent: async () => ({ items: pageItems[n - 1] }),
        cleanup: () => {
          doc.cleaned++;
        }
      };
    }
  };
  return doc;
}

describe("extractFromDocument", () => {
  it("sayfaları sırayla çıkarır, sayfaları temizler ve ilerleme bildirir", async () => {
    const doc = fakeDoc([[line("Birinci sayfa metni.", 700)], [line("İkinci sayfa metni.", 700)]]);
    const progress: number[] = [];
    const out = await extractFromDocument(doc, { onProgress: (d) => progress.push(d) });
    expect(out.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(out.pages[1].paragraphs[0].text).toBe("İkinci sayfa metni.");
    expect(out.wordCount).toBe(6);
    expect(out.scannedPages).toBe(0);
    expect(progress).toEqual([1, 2]);
    expect(doc.cleaned).toBe(2);
  });

  it("kısmen taranmış PDF'te boş sayfaları sayar ama devam eder", async () => {
    const out = await extractFromDocument(fakeDoc([[line("Metin var.", 700)], [], [line("Yine var.", 700)]]));
    expect(out.scannedPages).toBe(1);
    expect(out.pages).toHaveLength(3);
  });

  it("yalnızca görselden oluşan PDF'te OCR uyarısı verir", async () => {
    const promise = extractFromDocument(fakeDoc([[], [], []]));
    await expect(promise).rejects.toThrow("OCR");
    await expect(extractFromDocument(fakeDoc([[]]))).rejects.toBeInstanceOf(UserError);
  });

  it("sayfasız belgeyi reddeder", async () => {
    await expect(extractFromDocument(fakeDoc([]))).rejects.toThrow("sayfa");
  });

  it("çok uzun belgeyi (3000+ sayfa) reddeder", async () => {
    const huge: PdfDocLike = { numPages: 3001, getPage: async () => { throw new Error("okunmamalı"); } };
    await expect(extractFromDocument(huge)).rejects.toThrow("çok uzun");
  });

  it("iptal sinyalinde durur", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(extractFromDocument(fakeDoc([[line("x y z", 700)]]), { signal: ctrl.signal })).rejects.toThrow("iptal");
  });
});
