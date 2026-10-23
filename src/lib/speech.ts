// Seslendirme planı: paragraf/başlık arası duraklamalar ve telaffuz sözlüğü.
// Cihazdan bağımsız, saf (pure) mantık; birim testleri Node'da çalışır.
//
// Oynatma parçaları (Chunk) ilerleme kaydı, ileri/geri ve ses dosyası önbelleği için olduğu gibi kalır.
// Burada her parça, yerel (Java) tarafın doğrudan okuyacağı bir "plan"a çevrilir:
//   parça = [ { text, pauseAfterMs }, ... ]   (segment = paragraf; ardından beklenecek süre)

import type { Chunk, Segment } from "./text.ts";

export type Pronunciation = {
  id: string;
  /** Metinde geçen yazılış (ör. "TBMM"). */
  from: string;
  /** Seslendirmede okunacak karşılığı (ör. "te be em em"). Boş olabilir: kelime atlanır. */
  to: string;
  /** Yalnızca tam kelime olarak eşleş (kelimenin içinde eşleşme). */
  wholeWord: boolean;
  /** Büyük/küçük harfi ayırt et. */
  matchCase: boolean;
};

/** Bekleme süreleri (ms). Hepsi 0 ise plan eski davranışla aynıdır: paragraflar tek metin olarak okunur. */
export type PauseSettings = {
  /** Paragraflar arası. */
  paragraphMs: number;
  /** Bir başlıktan önce (önceki bölümün sonu ile başlık arası). */
  headingBeforeMs: number;
  /** Bir başlıktan sonra (bölümün ilk paragrafına geçmeden önce). */
  headingAfterMs: number;
  /** Nokta (.) sonrası. Bir cümlenin sonu ile sonrakinin başı aynı boşluktur. */
  periodMs: number;
  /** Soru (?) ve ünlem (!) sonrası. */
  questionMs: number;
  /** Üç nokta (… ya da ...) sonrası; sonraki sözcük küçük harfle başlasa da uygulanır. */
  ellipsisMs: number;
  /** Virgül (,) sonrası. */
  commaMs: number;
  /** Noktalı virgül (;) sonrası. */
  semicolonMs: number;
  /** İki nokta (:) sonrası. */
  colonMs: number;
};
export type PlanSettings = PauseSettings & {
  /** Tamamı büyük harfli başlık/kelime dizilerini normal harfe çevirir (motor harf harf heceleyemesin). */
  lowerCaps?: boolean;
};
export type SpeechSegment = { text: string; pauseAfterMs: number };
export type SpeechChunk = SpeechSegment[];

export const MAX_PAUSE_MS = 5000;
export const MAX_PRONUNCIATIONS = 200;
export const MAX_FROM_LENGTH = 80;
export const MAX_TO_LENGTH = 200;

// ------------------------------------------------------------------ telaffuz sözlüğü

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

const escapeRegExp = (s: string) => s.replace(REGEX_SPECIAL, "\\$&");
const escapeClassChar = (s: string) => s.replace(/[\\\]^-]/g, "\\$&");

/** Boşlukları teke indirir; sözlük anahtarları bu biçimde karşılaştırılır. */
export const normalizeKey = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Türkçe büyük/küçük harf kurallarına göre (I/ı, İ/i) karşılaştırma anahtarı. */
const foldKey = (s: string): string => normalizeKey(s).toLocaleLowerCase("tr");

/**
 * Tek bir karakter için desen. Büyük/küçük harf duyarsızken `i` bayrağı kullanılmaz:
 * JS'in basit harf katlaması "I"yı "i"ye eşler, oysa Türkçede I ↔ ı ve İ ↔ i'dir.
 */
function charPattern(ch: string, matchCase: boolean): string {
  if (ch === " ") return "\\s+";
  if (matchCase) return escapeRegExp(ch);
  const variants = new Set([ch, ch.toLocaleLowerCase("tr"), ch.toLocaleUpperCase("tr")]);
  const single = [...variants].filter((c) => [...c].length === 1);
  if (single.length <= 1) return escapeRegExp(ch);
  return `[${single.map(escapeClassChar).join("")}]`;
}

/**
 * Sözlüğü tek bir geçişte uygulayan fonksiyon üretir.
 * - Tek geçiş: bir kuralın çıktısı başka bir kural tarafından yeniden eşleşmez.
 * - Aynı konumda uzun anahtar kısa olana üstün gelir ("Dr. Ahmet" > "Dr.").
 * - "Tam kelime" Unicode'a duyarlıdır (\b yalnızca ASCII'dir, Türkçe harflerde yanlış çalışır).
 *   Kesme işaretli ekler ("NASA'nın") tam kelime eşleşmesini bozmaz.
 */
export function compilePronunciations(entries: Pronunciation[]): (text: string) => string {
  const compiled: { pattern: string; to: string; length: number }[] = [];
  for (const entry of entries) {
    const key = normalizeKey(entry.from);
    if (!key) continue;
    const chars = [...key];
    const body = chars.map((c) => charPattern(c, entry.matchCase)).join("");
    const before = entry.wholeWord && WORD_CHAR.test(chars[0]) ? "(?<![\\p{L}\\p{N}_])" : "";
    const after = entry.wholeWord && WORD_CHAR.test(chars[chars.length - 1]) ? "(?![\\p{L}\\p{N}_])" : "";
    const pattern = before + body + after;
    try {
      new RegExp(pattern, "u");
    } catch {
      continue; // geçersiz desen bütün sözlüğü bozmasın
    }
    compiled.push({ pattern, to: entry.to, length: chars.length });
  }
  if (!compiled.length) return (text) => text;

  compiled.sort((a, b) => b.length - a.length);
  const re = new RegExp(compiled.map((c) => `(${c.pattern})`).join("|"), "gu");
  return (text) =>
    text.replace(re, (match: string, ...groups: unknown[]) => {
      for (let i = 0; i < compiled.length; i++) if (groups[i] !== undefined) return compiled[i].to;
      return match;
    });
}

/** Kayıtlı sözlüğü (localStorage metni) güvenle okur; bozuk kayıt uygulamayı düşürmez. */
export function parsePronunciations(raw: string): Pronunciation[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Pronunciation[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.from !== "string" || typeof o.to !== "string") continue;
    const from = normalizeKey(o.from);
    if (!from || from.length > MAX_FROM_LENGTH || o.to.length > MAX_TO_LENGTH) continue;
    out.push({
      id: typeof o.id === "string" && o.id ? o.id : `p${out.length}-${from}`,
      from,
      to: o.to,
      wholeWord: o.wholeWord !== false,
      matchCase: o.matchCase === true
    });
    if (out.length >= MAX_PRONUNCIATIONS) break;
  }
  return out;
}

/** Ekleme/düzenleme doğrulaması. Sorun yoksa null, varsa kullanıcıya gösterilecek Türkçe mesaj. */
export function validatePronunciation(
  from: string,
  to: string,
  list: Pronunciation[],
  editingId?: string | null
): string | null {
  const key = normalizeKey(from);
  if (!key) return "“Yazılışı” boş olamaz.";
  if (key.length > MAX_FROM_LENGTH) return `“Yazılışı” en fazla ${MAX_FROM_LENGTH} karakter olabilir.`;
  if (to.length > MAX_TO_LENGTH) return `“Okunuşu” en fazla ${MAX_TO_LENGTH} karakter olabilir.`;
  const replacing = list.some((p) => p.id === editingId || foldKey(p.from) === foldKey(key));
  if (!replacing && list.length >= MAX_PRONUNCIATIONS) {
    return `En fazla ${MAX_PRONUNCIATIONS} kural eklenebilir. Kullanmadıklarını sil.`;
  }
  return null;
}

/** Aynı kimlikli ya da aynı yazılışlı kuralın yerine geçer (yinelenen kural kalmaz); yoksa sona ekler. */
export function upsertPronunciation(list: Pronunciation[], entry: Pronunciation): Pronunciation[] {
  const key = foldKey(entry.from);
  const out: Pronunciation[] = [];
  let placed = false;
  for (const item of list) {
    if (item.id !== entry.id && foldKey(item.from) !== key) {
      out.push(item);
    } else if (!placed) {
      out.push(entry);
      placed = true;
    }
  }
  if (!placed) out.push(entry);
  return out;
}

// ------------------------------------------------------------------ büyük harfli yazılar

const VOWEL = /[AEIİOÖUÜaeıioöuü]/u;
const ROMAN = /^(?=[IVXLCDM])M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

/** Sesli harfi olan kelimeyi Türkçe kurallarla küçültür; TBMM/PTT gibi sesli harfsizler ve Romen rakamları (XIV) kalır. */
function lowerWord(word: string): string {
  return VOWEL.test(word) && !ROMAN.test(word) ? word.toLocaleLowerCase("tr") : word;
}

/**
 * Ses motorları tamamı büyük harfli kelimeleri kısaltma sanıp harf harf okur ("FISILDAYAN" → "F-I-S-I-…").
 * Bu yüzden iki durumda kelimeler küçültülür:
 *  1. Paragrafta hiç küçük harf yoksa (büyük harfli başlık/satır),
 *  2. Yan yana iki ya da daha fazla büyük harfli kelime varsa ("FISILDAYAN AĞAÇLAR ORMANI Bir varmış…").
 * Tek başına geçen büyük harfli kelimeler (NASA, ABD) olduğu gibi bırakılır; onlar için sözlük kullanılır.
 * Sesli harfi olmayan kısaltmalar (TBMM, PTT, THY) her durumda harf harf okunmaya devam eder.
 */
export function normalizeCaps(text: string): string {
  if (!/\p{Lu}/u.test(text)) return text;
  if (!/\p{Ll}/u.test(text)) return text.replace(/\p{L}+/gu, lowerWord);
  return text.replace(/(?<![\p{L}\p{N}])\p{Lu}{2,}(?:[\s'’-]+\p{Lu}{2,})+(?![\p{L}\p{N}])/gu, (run) =>
    run.replace(/\p{L}+/gu, lowerWord)
  );
}

// ------------------------------------------------------------------ duraklama planı

/** Cümle sonu işareti (ardından kapanış tırnak/parantezi olabilir). */
const SENTENCE_END = /[.!?…]["”»’')\]]*$/;

/** Sayfa sonunda yarım kalan cümle sonraki sayfada küçük harfle sürüyorsa araya duraklama konmaz. */
function continuesAcrossPages(prev: string, next: string): boolean {
  return !SENTENCE_END.test(prev.trim()) && /^\p{Ll}/u.test(next.trim());
}

/** Noktası cümle sonu sayılmayan yaygın Türkçe kısaltmalar ("Dr. Ahmet", "vb. şeyler"). Küçük harfle, noktasız. */
const ABBREVIATIONS = new Set([
  "dr", "prof", "doç", "yrd", "av", "uzm", "öğr", "arş", "müh", "mim", "gen", "alb", "yzb", "ütğm", "tğm", "kd", "bnb",
  "hz", "sn", "sa", "bkz", "krş", "vs", "vb", "vd", "örn", "yak", "age", "no", "tel", "mah", "cad", "sok", "apt", "bul",
  "mr", "mrs", "ms", "st", "jr", "sr", "bşk", "ünv", "fak", "ort", "çvş"
]);

const isTerminator = (c: string) => c === "." || c === "!" || c === "?" || c === "…";
const isCloser = (c: string) => c === '"' || c === "”" || c === "»" || c === "’" || c === "'" || c === ")" || c === "]";
const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\u00A0";

/**
 * Terminatörden sonra yeni bir cümle başlıyor mu? Başlamıyorsa duraklama konmaz:
 * - sonraki harf küçükse ("Gel! dedi.", "vb. şeyler"),
 * - nokta bir sıra sayısından ("19. yüzyıl", "II. Abdülhamit"), baş harften ("M. Kemal") ya da kısaltmadan ("Dr. Ahmet") sonra geliyorsa.
 * Şüphede duraklama konmaz: gereksiz bekleme, eksik bekleme­den daha rahatsız edicidir.
 */
function startsNewSentence(text: string, termStart: number, termEnd: number, next: number): boolean {
  if (/\p{Ll}/u.test(text[next])) return false;
  if (termEnd - termStart === 1 && text[termStart] === ".") {
    const before = /([\p{L}\p{N}]+)$/u.exec(text.slice(Math.max(0, termStart - 24), termStart));
    const word = before?.[1];
    if (word) {
      if (/^\p{N}+$/u.test(word) && word.length <= 3) return false; // sıra sayısı (yıllar ≥ 4 hane cümle sonu olabilir)
      if (/^\p{Lu}$/u.test(word)) return false; // baş harf
      if (ROMAN.test(word) && word.length <= 4) return false; // Romen sıra sayısı
      if (ABBREVIATIONS.has(foldKey(word))) return false;
    }
  }
  return true;
}

type Break = { at: number; ms: number };
type PunctuationPauses = Pick<PauseSettings, "periodMs" | "questionMs" | "ellipsisMs" | "commaMs" | "semicolonMs" | "colonMs">;

const punctuationOff = (p: PunctuationPauses) =>
  p.periodMs <= 0 && p.questionMs <= 0 && p.ellipsisMs <= 0 && p.commaMs <= 0 && p.semicolonMs <= 0 && p.colonMs <= 0;

/** Noktalama dizisinin türü: üç nokta (… / ..), soru-ünlem (? !) ya da tek nokta. */
function terminatorKind(run: string): "ellipsisMs" | "questionMs" | "periodMs" {
  if (run.includes("…") || run.includes("..")) return "ellipsisMs";
  if (run.includes("?") || run.includes("!")) return "questionMs";
  return "periodMs";
}

/**
 * Metindeki duraklama noktaları: `at` = parçanın bittiği konum (noktalama ve kapanış tırnağı dahil), `ms` = bekleme.
 * Süresi 0 olan noktalama türü hiç bölme noktası üretmez.
 */
function findBreaks(text: string, p: PunctuationPauses): Break[] {
  const breaks: Break[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (isTerminator(c)) {
      let j = i + 1;
      while (j < text.length && isTerminator(text[j])) j++;
      const termEnd = j;
      const kind = terminatorKind(text.slice(i, termEnd));
      while (j < text.length && isCloser(text[j])) j++;
      if (p[kind] > 0 && j < text.length && isSpace(text[j])) {
        let k = j;
        while (k < text.length && isSpace(text[k])) k++;
        // Üç nokta bir cümle sonu olmak zorunda değildir ("Ben... bilmiyorum."): sonraki harf küçük olsa da bekler.
        if (k < text.length && (kind === "ellipsisMs" || startsNewSentence(text, i, termEnd, k))) {
          breaks.push({ at: j, ms: p[kind] });
        }
      }
      i = j - 1;
    } else if (c === "," || c === ";" || c === ":") {
      const ms = c === "," ? p.commaMs : c === ";" ? p.semicolonMs : p.colonMs;
      // "1,5" gibi sayılar ve "10:30" gibi saatler boşluksuz olduğu için bölünmez.
      if (ms > 0 && i + 1 < text.length && isSpace(text[i + 1]) && text.slice(i + 1).trim()) breaks.push({ at: i + 1, ms });
    }
  }
  return breaks;
}

/** Bir paragrafı noktalama parçalarına böler; son parçanın `pause` değeri -1'dir (çağıran belirler). */
function splitPieces(text: string, p: PunctuationPauses): { text: string; pause: number }[] {
  if (punctuationOff(p)) return [{ text, pause: -1 }];
  const pieces: { text: string; pause: number }[] = [];
  let start = 0;
  for (const b of findBreaks(text, p)) {
    const piece = text.slice(start, b.at).trim();
    if (piece) pieces.push({ text: piece, pause: b.ms });
    start = b.at;
  }
  const last = text.slice(start).trim();
  if (last) pieces.push({ text: last, pause: -1 });
  else if (pieces.length) pieces[pieces.length - 1].pause = -1;
  return pieces;
}

/** Bir parçanın sonundaki noktalamaya göre bekleme (paragraf ortasındaki parça sınırı için); noktalama yoksa 0. */
function terminalPause(text: string, p: PunctuationPauses): number {
  let end = text.length;
  while (end > 0 && (isCloser(text[end - 1]) || isSpace(text[end - 1]))) end--;
  let start = end;
  while (start > 0 && isTerminator(text[start - 1])) start--;
  return start === end ? 0 : p[terminatorKind(text.slice(start, end))];
}

function boundaryPause(a: Segment, aPage: number, b: Segment, bPage: number, s: PauseSettings): number {
  // Aynı paragrafın devamı: parça sınırları cümle sınırlarına denk gelir; bekleme cümlenin noktalamasına bağlıdır.
  if (!b.newParagraph) return terminalPause(a.text, s);
  if (aPage !== bPage && !a.heading && !b.heading && continuesAcrossPages(a.text, b.text)) return 0;
  if (a.heading) return s.headingAfterMs;
  if (b.heading) return s.headingBeforeMs;
  return s.paragraphMs;
}

const clampMs = (ms: number) => (Number.isFinite(ms) ? Math.max(0, Math.min(MAX_PAUSE_MS, Math.round(ms))) : 0);

/**
 * Parçalardan seslendirme planını üretir.
 * - Paragraflar arası `paragraphMs`; başlıktan önce `headingBeforeMs`, sonra `headingAfterMs`.
 * - Nokta, soru/ünlem, üç nokta, virgül, noktalı virgül ve iki nokta için ayrı süreler: süresi > 0 olan noktalamada
 *   paragraf bölünür ve araya bekleme konur. Üç nokta, sonraki sözcük küçük harfle başlasa da bekler.
 *   Kısaltma ("Dr. Ahmet"), sıra sayısı ("19. yüzyıl"), baş harf ("M. Kemal") ve küçük harfle süren konuşma
 *   etiketleri ("Gel! dedi.") cümle sonu sayılmaz. Başlıklar bölünmez.
 * - Duraklaması 0 olan ardışık parçalar tek metin olarak birleştirilir (paragraflar "\n", cümleler " " ile);
 *   yani 0 = eski davranış, gereksiz motor çağrısı yok.
 * - Telaffuz sözlüğü yalnızca burada, seslendirilecek metne uygulanır; ekrandaki metin değişmez.
 *   Sözlük cümle bölmeden ÖNCE çalışır: "Dr." → "doktor" gibi kurallar nokta kaynaklı hatalı bekleme de önler.
 *   Sözlükten sonra (isteğe bağlı) büyük harfli yazılar normalleştirilir; böylece "ABD" gibi
 *   sözlük kuralları büyük harfli haliyle eşleşmeye devam eder.
 * - Parça sayısı ve sırası değişmez: ilerleme/ileri-geri indeksleri aynı kalır.
 */
export function buildSpeechPlan(
  chunks: Chunk[],
  settings: PlanSettings,
  pronounce: (text: string) => string = (t) => t
): SpeechChunk[] {
  const pauses: PauseSettings = {
    paragraphMs: clampMs(settings.paragraphMs),
    headingBeforeMs: clampMs(settings.headingBeforeMs),
    headingAfterMs: clampMs(settings.headingAfterMs),
    periodMs: clampMs(settings.periodMs),
    questionMs: clampMs(settings.questionMs),
    ellipsisMs: clampMs(settings.ellipsisMs),
    commaMs: clampMs(settings.commaMs),
    semicolonMs: clampMs(settings.semicolonMs),
    colonMs: clampMs(settings.colonMs)
  };
  const plan: SpeechChunk[] = [];

  for (let k = 0; k < chunks.length; k++) {
    const chunk = chunks[k];
    const out: SpeechSegment[] = [];
    let lastPause = 0;

    const push = (text: string, pause: number, joiner: string) => {
      const prev = out[out.length - 1];
      if (prev && prev.pauseAfterMs === 0) {
        prev.text += joiner + text;
        prev.pauseAfterMs = pause;
      } else {
        out.push({ text, pauseAfterMs: pause });
      }
    };

    for (let j = 0; j < chunk.segments.length; j++) {
      const seg = chunk.segments[j];
      let next: { seg: Segment; page: number } | null = null;
      if (j + 1 < chunk.segments.length) next = { seg: chunk.segments[j + 1], page: chunk.page };
      else if (chunks[k + 1]?.segments[0]) next = { seg: chunks[k + 1].segments[0], page: chunks[k + 1].page };
      const pause = next ? boundaryPause(seg, chunk.page, next.seg, next.page, pauses) : 0;
      lastPause = pause;

      const spoken = pronounce(seg.text);
      const text = (settings.lowerCaps ? normalizeCaps(spoken) : spoken).trim();
      if (!text) {
        // Sözlük kelimeyi tamamen silmiş olabilir; bekleme süresi önceki segmentte korunur.
        const prev = out[out.length - 1];
        if (prev) prev.pauseAfterMs = Math.max(prev.pauseAfterMs, pause);
        continue;
      }

      const pieces = seg.heading ? [{ text, pause: -1 }] : splitPieces(text, pauses);
      pieces.forEach((piece, n) => push(piece.text, piece.pause < 0 ? pause : piece.pause, n === 0 ? "\n" : " "));
    }

    // Boş parça kuyruğu bozmasın (yerel taraf da aynı hileyi kullanır).
    if (!out.length) out.push({ text: ".", pauseAfterMs: lastPause });
    plan.push(out);
  }
  return plan;
}
