import { describe, expect, it } from "vitest";
import {
  MAX_TTS_CHARS,
  buildChunks,
  countWords,
  estimateMinutes,
  fnv1a,
  normalizeText,
  splitForTts
} from "./text.ts";
import type { PageContent } from "./text.ts";

const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe("normalizeText", () => {
  it("birleştirir: satır sonunda bölünmüş kelime", () => {
    expect(normalizeText("Ormanda ke-\nlebek uçuyordu.")).toBe("Ormanda kelebek uçuyordu.");
  });
  it("büyük harfle devam eden tireyi korur", () => {
    expect(normalizeText("Kuzey-\nGüney yolu")).toBe("Kuzey-\nGüney yolu");
  });
  it("ligatür ve görünmez karakterleri temizler", () => {
    expect(normalizeText("o\uFB01s\u00ADi\u200Bn")).toBe("ofisin");
  });
  it("boşlukları toparlar ve Türkçe karakterleri bozmaz", () => {
    expect(normalizeText("  İstanbul   ışığı \t çok   güzel  ")).toBe("İstanbul ışığı çok güzel");
  });
});

describe("splitForTts", () => {
  it("boş metinde parça döndürmez", () => {
    expect(splitForTts("   \n ")).toEqual([]);
  });
  it("kısa metni tek parça tutar", () => {
    expect(splitForTts("Merhaba dünya.")).toEqual(["Merhaba dünya."]);
  });
  it("limiti aşmaz ve Türkçe karakterleri korur", () => {
    const chunks = splitForTts("Türkçe karakterler: ş ç ğ ı ö ü. ".repeat(200), 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    expect(chunks.join(" ")).toContain("ş ç ğ ı ö ü");
  });
  it("metin kaybetmez (kelime kelime aynı)", () => {
    const text = "Birinci paragraf burada biter.\n\nİkinci paragraf daha uzundur, bir iki üç dört. Üçüncü cümle de var!\nSon satır?";
    const out = splitForTts(text, 40);
    expect(words(out.join(" "))).toEqual(words(text));
  });
  it("uzun paragrafı cümle sınırında keser", () => {
    const sentence = "Bu bir deneme cümlesidir. ";
    const chunks = splitForTts(sentence.repeat(50), 200);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.slice(0, -1).every((c) => c.endsWith("."))).toBe(true);
  });
  it("boşluksuz dev kelimeyi sert keser, karakter kaybetmez", () => {
    const giant = "a".repeat(1000);
    const out = splitForTts(giant, 100);
    expect(out.every((c) => c.length <= 100)).toBe(true);
    expect(out.join("")).toBe(giant);
  });
  it("vekil çiftini (emoji) ikiye bölmez", () => {
    const out = splitForTts("😀".repeat(100), 11);
    for (const c of out) expect(Array.from(c).every((ch) => ch === "😀")).toBe(true);
  });
  it("Android TTS sınırını (4000) asla aşmaz", () => {
    const out = splitForTts("Uzun cümle ".repeat(3000), 100000);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.length <= MAX_TTS_CHARS)).toBe(true);
  });
  it("1,5 MB metni makul sürede böler", () => {
    const big = "Küçük bir hikâye anlatıyorum. İçinde ş, ç, ğ, ı, ö, ü harfleri var.\n".repeat(21000);
    const t0 = Date.now();
    const out = splitForTts(big);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(out.every((c) => c.length <= 1200)).toBe(true);
  });
});

describe("buildChunks", () => {
  const pages: PageContent[] = [
    { page: 1, paragraphs: [{ text: "BÖLÜM 1. Ormandaki Ev", heading: true }, { text: "Bir varmış bir yokmuş." }] },
    { page: 2, paragraphs: [{ text: "İkinci sayfa metni." }] },
    { page: 3, paragraphs: [] },
    { page: 4, paragraphs: [{ text: "BÖLÜM 2", heading: true }, { text: "Yeni gün doğdu." }] }
  ];
  it("parçalar sayfa sınırını geçmez ve sayfa numarası taşır", () => {
    const { chunks } = buildChunks(pages);
    expect(chunks.map((c) => c.page)).toEqual([1, 2, 4]);
  });
  it("başlıklardan bölüm listesi üretir ve parça indeksine bağlar", () => {
    const { chunks, sections } = buildChunks(pages);
    expect(sections).toEqual([
      { title: "BÖLÜM 1. Ormandaki Ev", page: 1, chunk: 0 },
      { title: "BÖLÜM 2", page: 4, chunk: 2 }
    ]);
    expect(chunks.map((c) => c.section)).toEqual([0, 0, 1]);
  });
  it("aynı sayfadaki ikinci başlık yeni parça başlatır", () => {
    const { chunks, sections } = buildChunks([
      { page: 1, paragraphs: [{ text: "Giriş metni." }, { text: "BÖLÜM 2", heading: true }, { text: "Devam." }] }
    ]);
    expect(chunks).toHaveLength(2);
    expect(sections[0].chunk).toBe(1);
  });
  it("başlık yoksa bölüm listesi boş kalır", () => {
    expect(buildChunks([{ page: 1, paragraphs: [{ text: "Sade metin." }] }]).sections).toEqual([]);
  });
});

describe("yardımcılar", () => {
  it("kelime sayar", () => {
    expect(countWords("  bir iki   üç ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
  it("süre tahmini hıza göre değişir", () => {
    expect(estimateMinutes(0)).toBe(0);
    expect(estimateMinutes(150)).toBe(1);
    expect(estimateMinutes(1500)).toBe(10);
    expect(estimateMinutes(1500, 1.4)).toBeLessThan(10);
  });
  it("özet deterministiktir ve girdiyle değişir", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });
});

describe("buildChunks: segmentler (duraklama planı için)", () => {
  it("segmentlerin \"\\n\" ile birleşimi parça metnidir; başlık işaretlenir", () => {
    const { chunks } = buildChunks([
      { page: 1, paragraphs: [{ text: "BÖLÜM 1", heading: true }, { text: "Bir varmış." }, { text: "Bir yokmuş." }] }
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].segments).toEqual([
      { text: "BÖLÜM 1", heading: true, newParagraph: true },
      { text: "Bir varmış.", heading: false, newParagraph: true },
      { text: "Bir yokmuş.", heading: false, newParagraph: true }
    ]);
    expect(chunks[0].segments.map((s) => s.text).join("\n")).toBe(chunks[0].text);
  });
  it("parçalara bölünen uzun paragrafın devamı newParagraph=false olur", () => {
    const long = Array.from({ length: 30 }, () => "Bu bir deneme cümlesidir.").join(" ");
    const { chunks } = buildChunks([{ page: 1, paragraphs: [{ text: long }] }], 120);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].segments[0].newParagraph).toBe(true);
    for (const c of chunks.slice(1)) expect(c.segments[0].newParagraph).toBe(false);
    for (const c of chunks) expect(c.segments).toHaveLength(1);
  });
  it("parça sınırları ve metinleri segment bilgisinden bağımsız olarak eskisiyle aynıdır", () => {
    const text = "Birinci paragraf burada biter.\nİkinci paragraf daha uzundur, bir iki üç dört. Üçüncü cümle de var!\nSon satır?";
    const viaChunks = buildChunks([{ page: 1, paragraphs: text.split("\n").map((t) => ({ text: t })) }], 40).chunks.map((c) => c.text);
    expect(viaChunks).toEqual(splitForTts(text, 40));
  });
});
