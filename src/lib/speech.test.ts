import { describe, expect, it } from "vitest";
import {
  MAX_PRONUNCIATIONS,
  buildSpeechPlan,
  compilePronunciations,
  parsePronunciations,
  upsertPronunciation,
  validatePronunciation
} from "./speech.ts";
import type { Pronunciation } from "./speech.ts";
import { buildChunks } from "./text.ts";
import type { PageContent } from "./text.ts";

const entry = (from: string, to: string, extra: Partial<Pronunciation> = {}): Pronunciation => ({
  id: `id-${from}`,
  from,
  to,
  wholeWord: true,
  matchCase: false,
  ...extra
});

const P = { paragraphMs: 400, headingMs: 900 };

describe("compilePronunciations", () => {
  it("kural yoksa metni olduğu gibi bırakır", () => {
    expect(compilePronunciations([])("Merhaba dünya.")).toBe("Merhaba dünya.");
  });
  it("tam kelimeyi değiştirir, kelime içinde eşleşmez", () => {
    const f = compilePronunciations([entry("AB", "avrupa birliği")]);
    expect(f("AB üyesi. ABD ve KAB.")).toBe("avrupa birliği üyesi. ABD ve KAB.");
  });
  it("kesme işaretli ekten sonra da çalışır", () => {
    const f = compilePronunciations([entry("NASA", "nasa")]);
    expect(f("NASA'nın roketi")).toBe("nasa'nın roketi");
  });
  it("Türkçe büyük/küçük harf: I↔ı, İ↔i", () => {
    const f = compilePronunciations([entry("ısparta", "ıspartaa"), entry("izmir", "izmiir")]);
    expect(f("ISPARTA ve Isparta")).toBe("ıspartaa ve ıspartaa");
    expect(f("İZMİR ve İzmir")).toBe("izmiir ve izmiir");
  });
  it("Türkçe I, i ile karışmaz", () => {
    const f = compilePronunciations([entry("ısı", "sıcaklık")]);
    expect(f("ISI, ısı, isi")).toBe("sıcaklık, sıcaklık, isi");
  });
  it("harf duyarlı kural yalnızca birebir yazılışı eşler", () => {
    const f = compilePronunciations([entry("Can", "can", { matchCase: true })]);
    expect(f("Can geldi, can verdi, CAN")).toBe("can geldi, can verdi, CAN");
  });
  it("tam kelime kapalıyken ekli kelimelerin kökünü de değiştirir", () => {
    const f = compilePronunciations([entry("kitap", "kitab", { wholeWord: false })]);
    expect(f("kitaplarda")).toBe("kitablarda");
  });
  it("noktayla biten kısaltma sonrası harf gelse de eşleşir", () => {
    const f = compilePronunciations([entry("Dr.", "doktor")]);
    expect(f("Dr. Ahmet ve Dr.Ayşe")).toBe("doktor Ahmet ve doktorAyşe");
  });
  it("kuralın çıktısı başka kuralla yeniden eşleşmez (tek geçiş)", () => {
    const f = compilePronunciations([entry("ABD", "a be de"), entry("de", "DE")]);
    expect(f("ABD ve de")).toBe("a be de ve DE");
  });
  it("aynı konumda uzun anahtar kısa olana üstün gelir", () => {
    const f = compilePronunciations([entry("Dr.", "doktor"), entry("Dr. Ahmet", "doktor Ahmet Bey")]);
    expect(f("Dr. Ahmet geldi, Dr. Ayşe de.")).toBe("doktor Ahmet Bey geldi, doktor Ayşe de.");
  });
  it("anahtardaki boşluk esnek eşleşir", () => {
    const f = compilePronunciations([entry("Mustafa  Kemal", "Mustafa Kemal Atatürk")]);
    expect(f("Mustafa Kemal geldi")).toBe("Mustafa Kemal Atatürk geldi");
  });
  it("regex özel karakterleri düz metin sayılır", () => {
    const f = compilePronunciations([entry("C++", "si plas plas"), entry("a.b", "a nokta b", { wholeWord: false })]);
    expect(f("C++ ve axb ve a.b")).toBe("si plas plas ve axb ve a nokta b");
  });
  it("$ içeren okunuşu olduğu gibi yazar", () => {
    const f = compilePronunciations([entry("USD", "$& dolar")]);
    expect(f("5 USD")).toBe("5 $& dolar");
  });
  it("boş okunuş kelimeyi siler", () => {
    expect(compilePronunciations([entry("www", "")])("www site")).toBe(" site");
  });
  it("boş yazılışlı kuralı yok sayar", () => {
    expect(compilePronunciations([entry("  ", "x")])("a b")).toBe("a b");
  });
  it("çok sayıda kuralla makul sürede çalışır", () => {
    const rules = Array.from({ length: MAX_PRONUNCIATIONS }, (_, i) => entry(`kelime${i}x`, `okunus${i}`));
    const f = compilePronunciations(rules);
    const big = "Küçük bir hikâye anlatıyorum. İçinde kelime7x var.\n".repeat(20000);
    const t0 = Date.now();
    const out = f(big);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(out).toContain("okunus7");
  });
});

describe("parsePronunciations / upsert / validate", () => {
  it("bozuk ya da yanlış biçimli kaydı boş liste sayar", () => {
    expect(parsePronunciations("{{")).toEqual([]);
    expect(parsePronunciations('{"a":1}')).toEqual([]);
    expect(parsePronunciations("")).toEqual([]);
  });
  it("geçerli kayıtları okur, bozukları atlar, varsayılanları uygular", () => {
    const raw = JSON.stringify([{ id: "1", from: "AB", to: "a be" }, { from: 5 }, null, { from: "", to: "x" }]);
    expect(parsePronunciations(raw)).toEqual([{ id: "1", from: "AB", to: "a be", wholeWord: true, matchCase: false }]);
  });
  it("kural sayısını sınırlar", () => {
    const raw = JSON.stringify(Array.from({ length: MAX_PRONUNCIATIONS + 50 }, (_, i) => ({ id: `${i}`, from: `k${i}`, to: "x" })));
    expect(parsePronunciations(raw)).toHaveLength(MAX_PRONUNCIATIONS);
  });
  it("aynı yazılışı (Türkçe harf katlamasıyla) yineleme yerine günceller", () => {
    const list = [entry("ISPARTA", "a"), entry("başka", "b")];
    const out = upsertPronunciation(list, { ...entry("ısparta", "c"), id: "yeni" });
    expect(out.map((p) => p.to)).toEqual(["c", "b"]);
  });
  it("düzenlenen kuralın yazılışı başka bir kuralla çakışırsa tek kural kalır", () => {
    const list = [entry("a", "1"), entry("b", "2")];
    const out = upsertPronunciation(list, { ...list[0], from: "b", to: "3" });
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe("3");
  });
  it("yeni yazılışı sona ekler", () => {
    expect(upsertPronunciation([entry("a", "1")], entry("b", "2")).map((p) => p.from)).toEqual(["a", "b"]);
  });
  it("doğrulama mesajları", () => {
    expect(validatePronunciation(" ", "x", [])).toContain("boş");
    expect(validatePronunciation("a".repeat(81), "x", [])).toContain("80");
    expect(validatePronunciation("AB", "AB", [])).toContain("aynı");
    expect(validatePronunciation("AB", "a be", [])).toBe(null);
    const full = Array.from({ length: MAX_PRONUNCIATIONS }, (_, i) => entry(`k${i}`, "x"));
    expect(validatePronunciation("yeni", "y", full)).toContain(String(MAX_PRONUNCIATIONS));
    expect(validatePronunciation("k3", "güncel", full)).toBe(null); // mevcut kuralı güncelleme sınıra takılmaz
  });
});

describe("buildSpeechPlan", () => {
  const pages: PageContent[] = [
    {
      page: 1,
      paragraphs: [
        { text: "BÖLÜM 1. Ormandaki Ev", heading: true },
        { text: "Bir varmış bir yokmuş." },
        { text: "İkinci paragraf burada." }
      ]
    },
    { page: 2, paragraphs: [{ text: "Üçüncü paragraf." }] },
    { page: 3, paragraphs: [{ text: "BÖLÜM 2", heading: true }, { text: "Yeni gün doğdu." }] }
  ];

  it("başlıkta, paragraflarda ve sayfa sınırlarında doğru süreleri koyar", () => {
    const { chunks } = buildChunks(pages);
    const plan = buildSpeechPlan(chunks, P);
    expect(plan).toHaveLength(chunks.length);
    expect(plan[0]).toEqual([
      { text: "BÖLÜM 1. Ormandaki Ev", pauseAfterMs: 900 }, // başlıktan sonra
      { text: "Bir varmış bir yokmuş.", pauseAfterMs: 400 }, // paragraflar arası
      { text: "İkinci paragraf burada.", pauseAfterMs: 400 } // sayfa sonu → sonraki paragraf
    ]);
    expect(plan[1]).toEqual([{ text: "Üçüncü paragraf.", pauseAfterMs: 900 }]); // sonraki parça başlıkla başlıyor
    expect(plan[2]).toEqual([
      { text: "BÖLÜM 2", pauseAfterMs: 900 },
      { text: "Yeni gün doğdu.", pauseAfterMs: 0 } // kitabın sonu: bekleme yok
    ]);
  });
  it("duraklama 0 ise paragraflar tek metinde birleşir (eski davranış)", () => {
    const { chunks } = buildChunks(pages);
    const plan = buildSpeechPlan(chunks, { paragraphMs: 0, headingMs: 0 });
    expect(plan[0]).toEqual([{ text: "BÖLÜM 1. Ormandaki Ev\nBir varmış bir yokmuş.\nİkinci paragraf burada.", pauseAfterMs: 0 }]);
    expect(plan.map((c) => c.map((s) => s.text).join("\n"))).toEqual(chunks.map((c) => c.text));
  });
  it("yalnızca başlık süresi 0 iken paragraf süresi korunur", () => {
    const { chunks } = buildChunks(pages);
    const plan = buildSpeechPlan(chunks, { paragraphMs: 400, headingMs: 0 });
    expect(plan[0][0].text).toBe("BÖLÜM 1. Ormandaki Ev\nBir varmış bir yokmuş.");
    expect(plan[0][0].pauseAfterMs).toBe(400);
  });
  it("paragraf ortasındaki parça sınırında duraklama koymaz", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Bu ${i}. cümledir ve oldukça uzun bir cümle olsun diye uzatıldı.`).join(" ");
    const { chunks } = buildChunks([{ page: 1, paragraphs: [{ text: long }, { text: "Sonraki paragraf." }] }], 200);
    expect(chunks.length).toBeGreaterThan(2);
    const plan = buildSpeechPlan(chunks, P);
    // paragrafın ortasındaki parça sınırlarında bekleme yok
    for (let i = 0; i < plan.length - 1; i++) expect(plan[i][plan[i].length - 1].pauseAfterMs).toBe(0);
    // son parça: uzun paragrafın kuyruğu (ardından yeni paragraf → bekleme) + "Sonraki paragraf." (kitap sonu → yok)
    const last = plan[plan.length - 1];
    expect(last.map((s) => s.pauseAfterMs)).toEqual([400, 0]);
    expect(last[1].text).toBe("Sonraki paragraf.");
  });
  it("sayfa sonunda yarım kalan cümleyi sonraki sayfada küçük harfle sürdürürse duraklamaz", () => {
    const { chunks } = buildChunks([
      { page: 1, paragraphs: [{ text: "Çocuk koşarak eve" }] },
      { page: 2, paragraphs: [{ text: "girdi ve annesine sarıldı." }] }
    ]);
    expect(buildSpeechPlan(chunks, P)[0][0].pauseAfterMs).toBe(0);
    const ended = buildChunks([
      { page: 1, paragraphs: [{ text: "Çocuk eve girdi." }] },
      { page: 2, paragraphs: [{ text: "girdi ve annesine sarıldı." }] }
    ]).chunks;
    expect(buildSpeechPlan(ended, P)[0][0].pauseAfterMs).toBe(400);
  });
  it("sözlüğü yalnızca seslendirilecek metne uygular", () => {
    const { chunks } = buildChunks(pages);
    const plan = buildSpeechPlan(chunks, P, compilePronunciations([entry("BÖLÜM", "bölüm")]));
    expect(plan[0][0].text).toBe("bölüm 1. Ormandaki Ev");
    expect(chunks[0].text).toContain("BÖLÜM 1"); // kaynak metin değişmez
  });
  it("sözlük bir paragrafı tamamen silerse süre korunur, parça sayısı değişmez", () => {
    const { chunks } = buildChunks([{ page: 1, paragraphs: [{ text: "Merhaba." }, { text: "www" }, { text: "Son." }] }]);
    const plan = buildSpeechPlan(chunks, P, compilePronunciations([entry("www", "")]));
    expect(plan).toHaveLength(chunks.length);
    expect(plan[0]).toEqual([
      { text: "Merhaba.", pauseAfterMs: 400 },
      { text: "Son.", pauseAfterMs: 0 }
    ]);
  });
  it("tüm parça silinirse boş bırakmaz", () => {
    const { chunks } = buildChunks([{ page: 1, paragraphs: [{ text: "www" }] }]);
    const plan = buildSpeechPlan(chunks, P, compilePronunciations([entry("www", "")]));
    expect(plan).toEqual([[{ text: ".", pauseAfterMs: 0 }]]);
  });
  it("uç değerleri sınırlar", () => {
    const { chunks } = buildChunks(pages);
    const plan = buildSpeechPlan(chunks, { paragraphMs: -5, headingMs: 999999 });
    expect(plan[0][0].pauseAfterMs).toBe(5000);
    expect(plan[0][1].pauseAfterMs).toBe(0);
  });
  it("aynı girdide aynı plan (ses dosyası imzası için kararlı)", () => {
    const { chunks } = buildChunks(pages);
    expect(JSON.stringify(buildSpeechPlan(chunks, P))).toBe(JSON.stringify(buildSpeechPlan(chunks, P)));
    expect(JSON.stringify(buildSpeechPlan(chunks, P))).not.toBe(JSON.stringify(buildSpeechPlan(chunks, { ...P, paragraphMs: 500 })));
  });
});
