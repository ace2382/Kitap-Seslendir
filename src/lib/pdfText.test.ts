import { describe, expect, it } from "vitest";
import { isHeadingText, itemsToParagraphs } from "./pdfText.ts";
import type { TextItemLike } from "./pdfText.ts";

// PDF koordinatları: y yukarı doğru artar, satırlar aşağı indikçe y azalır.
const item = (str: string, x: number, y: number, size = 12, hasEOL = false): TextItemLike => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width: str.length * size * 0.5,
  height: size,
  hasEOL
});

describe("itemsToParagraphs", () => {
  it("boş girdide boş döner (taranmış sayfa)", () => {
    expect(itemsToParagraphs([])).toEqual([]);
    expect(itemsToParagraphs([{ type: "beginMarkedContent" }])).toEqual([]);
  });

  it("satırları paragrafa birleştirir, geniş boşlukta paragrafı ayırır", () => {
    const out = itemsToParagraphs([
      item("Bir varmış, bir yokmuş.", 50, 700),
      item("Küçük bir kız yaşarmış.", 50, 686),
      item("Ertesi sabah erkenden kalkmış.", 50, 640)
    ]);
    expect(out.map((p) => p.text)).toEqual([
      "Bir varmış, bir yokmuş. Küçük bir kız yaşarmış.",
      "Ertesi sabah erkenden kalkmış."
    ]);
  });

  it("satır sonu tire ile bölünen kelimeyi birleştirir", () => {
    const out = itemsToParagraphs([item("Ormanda bir ke-", 50, 700), item("lebek uçuyordu.", 50, 686)]);
    expect(out[0].text).toBe("Ormanda bir kelebek uçuyordu.");
  });

  it("büyük puntolu satırı başlık olarak işaretler", () => {
    const out = itemsToParagraphs([
      item("Ormandaki Ev", 50, 740, 22),
      item("Bir varmış, bir yokmuş.", 50, 700),
      item("Küçük bir kız yaşarmış.", 50, 686)
    ]);
    expect(out[0]).toEqual({ text: "Ormandaki Ev", heading: true });
    expect(out[1].heading).toBeUndefined();
  });

  it("ardışık başlık satırlarını tek başlık yapar", () => {
    const out = itemsToParagraphs([
      item("BÖLÜM 1", 50, 740, 22),
      item("Ormandaki Ev", 50, 712, 22),
      item("Bir varmış, bir yokmuş.", 50, 660)
    ]);
    expect(out[0]).toEqual({ text: "BÖLÜM 1. Ormandaki Ev", heading: true });
  });

  it("geniş satır aralığında (1,8×) satırları ayrı paragraf sanmaz, gerçek paragraf boşluğunu yine ayırır", () => {
    // punto 12, satır aralığı 22 (≈1,8×); paragraflar arası 44
    const out = itemsToParagraphs([
      item("Birinci satır burada.", 50, 700),
      item("ikinci satır devam eder", 50, 678),
      item("ve üçüncü satırla biter.", 50, 656),
      item("Yeni paragraf başlıyor", 50, 612),
      item("ve onun devamı var.", 50, 590)
    ]);
    expect(out.map((p) => p.text)).toEqual([
      "Birinci satır burada. ikinci satır devam eder ve üçüncü satırla biter.",
      "Yeni paragraf başlıyor ve onun devamı var."
    ]);
  });

  it("sayfa numarasını atar", () => {
    const out = itemsToParagraphs([item("Hikâye devam ediyordu.", 50, 700), item("12", 300, 30)]);
    expect(out.map((p) => p.text)).toEqual(["Hikâye devam ediyordu."]);
  });

  it("girintili ilk satırı yeni paragraf sayar", () => {
    const out = itemsToParagraphs([
      item("Birinci paragrafın sonu geldi.", 50, 700),
      item("İkinci paragraf girintiyle başlar.", 80, 686),
      item("ve böyle devam eder.", 50, 672)
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].text).toBe("İkinci paragraf girintiyle başlar. ve böyle devam eder.");
  });
});

describe("isHeadingText", () => {
  it("numaralı bölüm başlıklarını tanır", () => {
    expect(isHeadingText("Bölüm 3", 12, 12)).toBe(true);
    expect(isHeadingText("2. Bölüm", 12, 12)).toBe(true);
    expect(isHeadingText("Chapter IV", 12, 12)).toBe(true);
    expect(isHeadingText("ÖNSÖZ", 12, 12)).toBe(true);
  });
  it("sıradan cümleyi başlık sanmaz", () => {
    expect(isHeadingText("Bölüm müdürü içeri girdi.", 12, 12)).toBe(false);
    expect(isHeadingText("Küçük kız yola çıktı.", 12, 12)).toBe(false);
  });
});
