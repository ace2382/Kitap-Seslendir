// Cihazdan bağımsız, saf (pure) metin işleme fonksiyonları.
// Bu dosya DOM / Capacitor / pdf.js'e bağlı değildir; birim testleri Node'da çalışır.

export type Paragraph = { text: string; heading?: boolean };
export type PageContent = { page: number; paragraphs: Paragraph[] };
/**
 * Bir parçanın içindeki paragraf (ya da uzun bir paragrafın o parçaya düşen kısmı).
 * `newParagraph` yanlışsa bu segment, önceki parçada başlayan paragrafın devamıdır.
 */
export type Segment = { text: string; heading: boolean; newParagraph: boolean };
/** `text` = segmentlerin "\n" ile birleşimi (eski davranışla birebir aynı); `segments` duraklama planı içindir. */
export type Chunk = { text: string; page: number; section: number; segments: Segment[] };
export type Section = { title: string; page: number; chunk: number };

/** Oynatma parçası boyutu. Küçük parça = duraklatınca en fazla ~1 dk geri sarar. */
export const CHUNK_CHARS = 1200;
/** Android TextToSpeech.getMaxSpeechInputLength() = 4000; güvenli üst sınır. */
export const MAX_TTS_CHARS = 3800;

const LIGATURES: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st"
};

export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[\uFB00-\uFB06]/g, (c) => LIGATURES[c] ?? c)
    .replace(/\u00AD/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Satır sonunda bölünmüş kelime: "ke-\nlime" -> "kelime" (devamı küçük harfse)
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Normal hızda (1.0×) dakikada yaklaşık 150 kelime. */
export function estimateMinutes(words: number, rate = 1): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / (150 * Math.max(0.5, rate))));
}

const SENTENCE_END = /[.!?…]/;
const CLOSERS = /[.!?…"”»’')\]]/;

function splitSentences(paragraph: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < paragraph.length; i++) {
    if (!SENTENCE_END.test(paragraph[i])) continue;
    let j = i + 1;
    while (j < paragraph.length && CLOSERS.test(paragraph[j])) j++;
    if (j >= paragraph.length || /\s/.test(paragraph[j])) {
      const s = paragraph.slice(start, j).trim();
      if (s) parts.push(s);
      start = j;
      i = j - 1;
    }
  }
  const rest = paragraph.slice(start).trim();
  if (rest) parts.push(rest);
  return parts;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Tek bir cümle sınırdan uzunsa boşluklardan, olmazsa sert keserek böler. */
function hardSplit(sentence: string, max: number): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.4) {
      cut = max;
      // Vekil (surrogate) çiftini ikiye bölme
      if (isHighSurrogate(rest.charCodeAt(cut - 1))) cut -= 1;
    }
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

type Unit = { text: string; newParagraph: boolean; heading: boolean };

function clampMax(maxChars: number): number {
  return Math.max(10, Math.min(maxChars, MAX_TTS_CHARS));
}

/** Paragrafları cümle (gerekirse daha küçük) birimlerine ayırır; her birim paragraf başı/başlık bilgisini taşır. */
function toUnits(paragraphs: Paragraph[], max: number): Unit[] {
  const units: Unit[] = [];
  for (const paragraph of paragraphs) {
    for (const line of paragraph.text.replace(/\r\n?/g, "\n").split(/\n+/)) {
      const p = line.trim();
      if (!p) continue;
      let first = true;
      for (const sentence of splitSentences(p)) {
        for (const piece of sentence.length > max ? hardSplit(sentence, max) : [sentence]) {
          units.push({ text: piece, newParagraph: first, heading: !!paragraph.heading });
          first = false;
        }
      }
    }
  }
  return units;
}

/** Birimleri `max` karakteri aşmayan parçalara paketler. Parça metni ve sınırları eskisiyle aynıdır. */
function packUnits(units: Unit[], max: number): { text: string; segments: Segment[] }[] {
  const out: { text: string; segments: Segment[] }[] = [];
  let text = "";
  let segments: Segment[] = [];
  const seg = (u: Unit): Segment => ({ text: u.text, heading: u.heading, newParagraph: u.newParagraph });
  for (const unit of units) {
    if (!text) {
      text = unit.text;
      segments = [seg(unit)];
      continue;
    }
    const sep = unit.newParagraph ? "\n" : " ";
    if (text.length + sep.length + unit.text.length > max) {
      out.push({ text, segments });
      text = unit.text;
      segments = [seg(unit)];
    } else {
      text += sep + unit.text;
      if (unit.newParagraph) segments.push(seg(unit));
      else segments[segments.length - 1].text += " " + unit.text;
    }
  }
  if (text) out.push({ text, segments });
  return out;
}

/**
 * Metni TTS için parçalara böler. Her parça en fazla `maxChars` karakterdir,
 * cümle/paragraf sınırlarında kesilmeye çalışılır, hiçbir metin kaybolmaz.
 */
export function splitForTts(text: string, maxChars = CHUNK_CHARS): string[] {
  const max = clampMax(maxChars);
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  return packUnits(toUnits([{ text: normalized }], max), max).map((c) => c.text);
}

/**
 * Sayfa içeriklerinden oynatma parçalarını ve bölüm listesini üretir.
 * - Parçalar sayfa sınırını geçmez (sayfa bazlı oynatma tam olur).
 * - Başlık satırı yeni bir parçayı başlatır (bölüm bazlı oynatma tam olur).
 */
export function buildChunks(
  pages: PageContent[],
  maxChars = CHUNK_CHARS
): { chunks: Chunk[]; sections: Section[] } {
  const chunks: Chunk[] = [];
  const sections: Section[] = [];
  let currentSection = -1;

  for (const page of pages) {
    const max = clampMax(maxChars);
    let segment: Paragraph[] = [];
    const flush = () => {
      if (!segment.length) return;
      for (const c of packUnits(toUnits(segment, max), max)) {
        chunks.push({ text: c.text, page: page.page, section: currentSection, segments: c.segments });
      }
      segment = [];
    };
    for (const paragraph of page.paragraphs) {
      const text = paragraph.text.trim();
      if (!text) continue;
      if (paragraph.heading) {
        flush();
        sections.push({ title: text.slice(0, 80), page: page.page, chunk: chunks.length });
        currentSection = sections.length - 1;
      }
      segment.push({ text, heading: paragraph.heading });
    }
    flush();
  }
  return { chunks, sections };
}

export function pagesToPlainText(pages: PageContent[]): string {
  return pages
    .map((p) => p.paragraphs.map((x) => x.text).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

/** Küçük, hızlı, kriptografik olmayan özet (ses önbelleği imzası için). */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
