import { describe, expect, it } from "vitest";
import {
  MAX_PRONUNCIATIONS,
  buildSpeechPlan,
  compilePronunciations,
  normalizeCaps,
  parsePronunciations,
  upsertPronunciation,
  validatePronunciation
} from "./speech.ts";
import type { PauseSettings, Pronunciation } from "./speech.ts";
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

/** Test kısayolu: paragraf ve başlık süreleri; cümle/virgül duraklaması varsayılan kapalı (eski davranış). */
const S = (paragraphMs: number, headingMs: number, extra: Partial<PauseSettings> = {}): PauseSettings => ({
  paragraphMs,
  headingBeforeMs: headingMs,
  headingAfterMs: headingMs,
  sentenceMs: 0,
  commaMs: 0,
  ...extra
});
const P = S(400, 900);

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
  it("yazılışı okunuşuyla aynı olan kural istisna olur (kısa kuralı engeller)", () => {
    const f = compilePronunciations([entry("hale", "hâle"), entry("hale getir", "hale getir")]);
    expect(f("Hale hale getir, Hale gelince hale")).toBe("hâle hale getir, hâle gelince hâle");
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
    expect(validatePronunciation("hale getir", "hale getir", [])).toBe(null); // istisna kuralı geçerli
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
    const plan = buildSpeechPlan(chunks, S(0, 0));
    expect(plan[0]).toEqual([{ text: "BÖLÜM 1. Ormandaki Ev\nBir varmış bir yokmuş.\nİkinci paragraf burada.", pauseAfterMs: 0 }]);
    expect(plan.map((c) => c.map((s) => s.text).join("\n"))).toEqual(chunks.map((c) => c.text));
  });
  it("yalnızca başlık süresi 0 iken paragraf süresi korunur", () => {
    const { chunks } = buildChunks(pages);
    const plan = buildSpeechPlan(chunks, S(400, 0));
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
    const plan = buildSpeechPlan(chunks, S(-5, 999999));
    expect(plan[0][0].pauseAfterMs).toBe(5000);
    expect(plan[0][1].pauseAfterMs).toBe(0);
  });
  it("aynı girdide aynı plan (ses dosyası imzası için kararlı)", () => {
    const { chunks } = buildChunks(pages);
    expect(JSON.stringify(buildSpeechPlan(chunks, P))).toBe(JSON.stringify(buildSpeechPlan(chunks, P)));
    expect(JSON.stringify(buildSpeechPlan(chunks, P))).not.toBe(JSON.stringify(buildSpeechPlan(chunks, { ...P, paragraphMs: 500 })));
  });
});

describe("normalizeCaps (büyük harfli yazıları heceleme)", () => {
  it("tamamı büyük harfli başlığı Türkçe kurallarla küçültür", () => {
    expect(normalizeCaps("FISILDAYAN AĞAÇLAR ORMANI")).toBe("fısıldayan ağaçlar ormanı");
    expect(normalizeCaps("İSTANBUL'UN IŞIKLARI")).toBe("istanbul'un ışıkları");
  });
  it("sesli harfi olmayan kısaltmalar harf harf okunmaya devam eder", () => {
    expect(normalizeCaps("TBMM TOPLANDI")).toBe("TBMM toplandı");
    expect(normalizeCaps("PTT")).toBe("PTT");
  });
  it("Romen rakamlarını bozmaz", () => {
    expect(normalizeCaps("BÖLÜM XIV")).toBe("bölüm XIV");
    expect(normalizeCaps("III. ORMAN")).toBe("III. orman");
  });
  it("başlığı paragrafa yapışmış ardışık büyük harfli kelimeleri küçültür", () => {
    expect(normalizeCaps("FISILDAYAN AĞAÇLAR ORMANI Bir varmış bir yokmuş.")).toBe("fısıldayan ağaçlar ormanı Bir varmış bir yokmuş.");
  });
  it("cümle içinde tek başına büyük harfli kelimeye dokunmaz", () => {
    expect(normalizeCaps("Dün NASA ve ABD açıklama yaptı.")).toBe("Dün NASA ve ABD açıklama yaptı.");
    expect(normalizeCaps("TBMM, ABD ile görüştü.")).toBe("TBMM, ABD ile görüştü.");
  });
  it("küçük harfli metni olduğu gibi bırakır", () => {
    expect(normalizeCaps("Bir varmış bir yokmuş.")).toBe("Bir varmış bir yokmuş.");
    expect(normalizeCaps("")).toBe("");
  });
  it("planda yalnızca açıkken uygulanır ve sözlükten sonra çalışır", () => {
    const { chunks } = buildChunks([{ page: 1, paragraphs: [{ text: "FISILDAYAN AĞAÇLAR ORMANI", heading: true }, { text: "Bir varmış." }] }]);
    expect(buildSpeechPlan(chunks, P)[0][0].text).toBe("FISILDAYAN AĞAÇLAR ORMANI");
    expect(buildSpeechPlan(chunks, { ...P, lowerCaps: true })[0][0].text).toBe("fısıldayan ağaçlar ormanı");
    const dict = compilePronunciations([entry("AĞAÇLAR", "AAĞAÇLAR", { matchCase: true })]);
    expect(buildSpeechPlan(chunks, { ...P, lowerCaps: true }, dict)[0][0].text).toBe("fısıldayan aağaçlar ormanı");
  });
});

/** Tek paragraflık metinden plan üretir (kısayol). */
const planOf = (text: string, settings: PauseSettings, heading = false) =>
  buildSpeechPlan(buildChunks([{ page: 1, paragraphs: [{ text, heading }] }]).chunks, settings);
const flat = (plan: ReturnType<typeof planOf>) => plan.flat().map((s) => [s.text, s.pauseAfterMs]);

describe("buildSpeechPlan: cümle ve virgül duraklamaları", () => {
  const SENT = S(600, 900, { sentenceMs: 300 });

  it("cümleler arasına bekleme koyar, son cümleye paragraf/kitap sonu kuralı uygulanır", () => {
    expect(flat(planOf("Birinci cümle. İkinci cümle! Üçüncü cümle?", SENT))).toEqual([
      ["Birinci cümle.", 300],
      ["İkinci cümle!", 300],
      ["Üçüncü cümle?", 0]
    ]);
  });
  it("virgül, noktalı virgül ve iki noktadan sonra ayrı bekleme koyar", () => {
    const plan = planOf("Gelir, görür; anlar: yine de susar.", S(600, 900, { commaMs: 150 }));
    expect(flat(plan)).toEqual([["Gelir,", 150], ["görür;", 150], ["anlar:", 150], ["yine de susar.", 0]]);
  });
  it("cümle ve virgül süreleri birlikte çalışır", () => {
    const plan = planOf("Gelir, görür. Sonra gider.", S(600, 900, { sentenceMs: 400, commaMs: 100 }));
    expect(flat(plan)).toEqual([["Gelir,", 100], ["görür.", 400], ["Sonra gider.", 0]]);
  });
  it("sayılar ve saatler virgül/iki noktada bölünmez", () => {
    expect(flat(planOf("Fiyat 1,5 lira, saat 10:30 oldu.", S(0, 0, { commaMs: 100 })))).toEqual([
      ["Fiyat 1,5 lira,", 100],
      ["saat 10:30 oldu.", 0]
    ]);
  });
  it("sıra sayısı, baş harf, kısaltma ve Romen sıra sayısından sonra bekleme koymaz", () => {
    const text = "19. yüzyılda M. Kemal ile Dr. Ahmet ve II. Abdülhamit vb. şeyler konuşuldu. Sonra bitti.";
    expect(flat(planOf(text, SENT))).toEqual([
      ["19. yüzyılda M. Kemal ile Dr. Ahmet ve II. Abdülhamit vb. şeyler konuşuldu.", 300],
      ["Sonra bitti.", 0]
    ]);
  });
  it("dört haneli sayıdan sonra gelen nokta (yıl) cümle sonu olabilir", () => {
    expect(flat(planOf("Bu iş 1990. Sonra her şey değişti.", SENT))).toEqual([["Bu iş 1990.", 300], ["Sonra her şey değişti.", 0]]);
  });
  it("küçük harfle süren konuşma etiketinden önce bekleme koymaz", () => {
    expect(flat(planOf("— Gel buraya! dedi anne. Çocuk koştu.", SENT))).toEqual([
      ["— Gel buraya! dedi anne.", 300],
      ["Çocuk koştu.", 0]
    ]);
  });
  it("kapanış tırnağı noktalamayla birlikte kalır", () => {
    expect(flat(planOf("\"Hayır.\" Kapıyı kapattı.", SENT))).toEqual([["\"Hayır.\"", 300], ["Kapıyı kapattı.", 0]]);
  });
  it("üç nokta ve ?! tek sınır sayılır", () => {
    expect(flat(planOf("Belki... Ya sonra?! Hayır.", SENT))).toEqual([["Belki...", 300], ["Ya sonra?!", 300], ["Hayır.", 0]]);
  });
  it("başlık cümle/virgül parçalarına bölünmez", () => {
    const plan = planOf("Bölüm 1. Ormandaki Ev, Gece", S(600, 900, { sentenceMs: 300, commaMs: 100 }), true);
    expect(flat(plan)).toEqual([["Bölüm 1. Ormandaki Ev, Gece", 0]]);
  });
  it("her ayar 0 iken eski davranış: paragraf içi cümleler tek metin", () => {
    const plan = planOf("Bir. İki, üç.", S(0, 0));
    expect(flat(plan)).toEqual([["Bir. İki, üç.", 0]]);
  });
  it("yalnızca cümle süresi 0 iken virgül süresi tek başına çalışır, cümleler birleşik kalır", () => {
    expect(flat(planOf("Bir, iki. Üç, dört.", S(0, 0, { commaMs: 100 })))).toEqual([["Bir,", 100], ["iki. Üç,", 100], ["dört.", 0]]);
  });
  it("paragraf sınırında paragraf süresi, paragraf içinde cümle süresi uygulanır", () => {
    const { chunks } = buildChunks([{ page: 1, paragraphs: [{ text: "A bir. A iki." }, { text: "B bir. B iki." }] }]);
    expect(flat(buildSpeechPlan(chunks, S(700, 900, { sentenceMs: 200 })))).toEqual([
      ["A bir.", 200],
      ["A iki.", 700],
      ["B bir.", 200],
      ["B iki.", 0]
    ]);
  });
  it("paragraf ortasındaki parça sınırında cümle süresi uygulanır", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Bu ${i}. cümledir ve oldukça uzun bir cümle olsun diye uzatıldı.`).join(" ");
    const { chunks } = buildChunks([{ page: 1, paragraphs: [{ text: long }] }], 200);
    expect(chunks.length).toBeGreaterThan(2);
    const plan = buildSpeechPlan(chunks, S(600, 900, { sentenceMs: 250 }));
    for (let i = 0; i < plan.length - 1; i++) expect(plan[i][plan[i].length - 1].pauseAfterMs).toBe(250);
    expect(plan[plan.length - 1][plan[plan.length - 1].length - 1].pauseAfterMs).toBe(0);
  });
  it("başlıktan önce ve sonra ayrı süreler kullanılır", () => {
    const { chunks } = buildChunks([
      { page: 1, paragraphs: [{ text: "Önceki bölümün son paragrafı." }, { text: "BÖLÜM 2", heading: true }, { text: "Yeni bölümün ilk paragrafı." }] }
    ]);
    const plan = buildSpeechPlan(chunks, S(400, 0, { headingBeforeMs: 1500, headingAfterMs: 700 }));
    expect(flat(plan)).toEqual([
      ["Önceki bölümün son paragrafı.", 1500],
      ["BÖLÜM 2", 700],
      ["Yeni bölümün ilk paragrafı.", 0]
    ]);
  });
  it("sözlük cümle bölmeden önce çalışır: 'Dr.' → 'doktor' hatalı bekleme üretmez", () => {
    const f = compilePronunciations([entry("Dr.", "doktor")]);
    const chunks = buildChunks([{ page: 1, paragraphs: [{ text: "Dr. Ahmet geldi. Sonra gitti." }] }]).chunks;
    expect(flat(buildSpeechPlan(chunks, SENT, f))).toEqual([["doktor Ahmet geldi.", 300], ["Sonra gitti.", 0]]);
  });
  it("hiçbir metin kaybolmaz: parçalar birleşince özgün metni verir (rastgele girdi)", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const bits = ["Bir", "iki,", "üç.", "Dört!", "beş?", "Dr.", "Ahmet", "19.", "yüzyıl", "M.", "Kemal", "dedi;", "\"Tamam.\"", "1,5", "10:30", "...", "—", "ışık:", "sonra"];
    for (let n = 0; n < 300; n++) {
      const text = Array.from({ length: 2 + Math.floor(rnd() * 30) }, () => bits[Math.floor(rnd() * bits.length)]).join(" ");
      const out = flat(planOf(text, S(300, 300, { sentenceMs: 200, commaMs: 100 }))).map((x) => x[0]).join(" ");
      expect(out.replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " ").trim());
    }
  });
});
