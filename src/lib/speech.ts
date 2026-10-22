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

export type PauseSettings = { paragraphMs: number; headingMs: number };
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
  if (key === to.trim()) return "Yazılış ile okunuş aynı; değiştirecek bir şey yok.";
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

// ------------------------------------------------------------------ duraklama planı

/** Cümle sonu işareti (ardından kapanış tırnak/parantezi olabilir). */
const SENTENCE_END = /[.!?…]["”»’')\]]*$/;

/** Sayfa sonunda yarım kalan cümle sonraki sayfada küçük harfle sürüyorsa araya duraklama konmaz. */
function continuesAcrossPages(prev: string, next: string): boolean {
  return !SENTENCE_END.test(prev.trim()) && /^\p{Ll}/u.test(next.trim());
}

function boundaryPause(a: Segment, aPage: number, b: Segment, bPage: number, s: PauseSettings): number {
  if (!b.newParagraph) return 0; // aynı paragrafın devamı (uzun paragraf parçalara bölünmüş)
  if (aPage !== bPage && !a.heading && !b.heading && continuesAcrossPages(a.text, b.text)) return 0;
  return a.heading || b.heading ? s.headingMs : s.paragraphMs;
}

const clampMs = (ms: number) => (Number.isFinite(ms) ? Math.max(0, Math.min(MAX_PAUSE_MS, Math.round(ms))) : 0);

/**
 * Parçalardan seslendirme planını üretir.
 * - Duraklama paragraflar arasında `paragraphMs`, bir başlığın öncesinde ve sonrasında `headingMs`'dir.
 * - Parça sınırı paragrafın ortasına denk geliyorsa duraklama yoktur.
 * - Duraklaması 0 olan ardışık paragraflar tek parça metin olarak ("\n" ile) birleştirilir;
 *   yani 0 = eski davranış, gereksiz motor çağrısı yok.
 * - Telaffuz sözlüğü yalnızca burada, seslendirilecek metne uygulanır; ekrandaki metin değişmez.
 * - Parça sayısı ve sırası değişmez: ilerleme/ileri-geri indeksleri aynı kalır.
 */
export function buildSpeechPlan(
  chunks: Chunk[],
  settings: PauseSettings,
  pronounce: (text: string) => string = (t) => t
): SpeechChunk[] {
  const pauses: PauseSettings = { paragraphMs: clampMs(settings.paragraphMs), headingMs: clampMs(settings.headingMs) };
  const plan: SpeechChunk[] = [];

  for (let k = 0; k < chunks.length; k++) {
    const chunk = chunks[k];
    const out: SpeechSegment[] = [];
    let lastPause = 0;

    for (let j = 0; j < chunk.segments.length; j++) {
      const seg = chunk.segments[j];
      let next: { seg: Segment; page: number } | null = null;
      if (j + 1 < chunk.segments.length) next = { seg: chunk.segments[j + 1], page: chunk.page };
      else if (chunks[k + 1]?.segments[0]) next = { seg: chunks[k + 1].segments[0], page: chunks[k + 1].page };
      const pause = next ? boundaryPause(seg, chunk.page, next.seg, next.page, pauses) : 0;
      lastPause = pause;

      const text = pronounce(seg.text).trim();
      const prev = out[out.length - 1];
      if (!text) {
        // Sözlük kelimeyi tamamen silmiş olabilir; bekleme süresi önceki segmentte korunur.
        if (prev) prev.pauseAfterMs = Math.max(prev.pauseAfterMs, pause);
        continue;
      }
      if (prev && prev.pauseAfterMs === 0) {
        prev.text += "\n" + text;
        prev.pauseAfterMs = pause;
      } else {
        out.push({ text, pauseAfterMs: pause });
      }
    }

    // Boş parça kuyruğu bozmasın (yerel taraf da aynı hileyi kullanır).
    if (!out.length) out.push({ text: ".", pauseAfterMs: lastPause });
    plan.push(out);
  }
  return plan;
}
