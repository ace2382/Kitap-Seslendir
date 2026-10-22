// pdf.js metin öğelerinden (satır, paragraf, başlık) okunabilir yapı üretir.
// pdf.js'e bağlı değildir; yalnızca TextItem benzeri nesneler alır, bu yüzden test edilebilir.

import { normalizeText } from "./text.ts";
import type { Paragraph } from "./text.ts";

export type TextItemLike = {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

type Line = { text: string; x: number; y: number; size: number };

const PAGE_NUMBER = /^[-–—\s]*\d{1,4}[-–—\s]*$/;
const SENTENCE_PUNCT = /[.!?…"”»’')]$/;
const NUMBERED_HEADING =
  /^(?:\d+\.\s*)?(?:bölüm|bolum|kısım|kisim|chapter|part|kitap)\s+(?:\d+|[ivxlc]+|bir|iki|üç|dört|beş|altı|alti|yedi|sekiz|dokuz|on)(?![\p{L}\d])/iu;
const ORDINAL_HEADING = /^\d+\.\s*(?:bölüm|bolum|kısım|kisim)\s*$/iu;
const NAMED_HEADING = /^(?:önsöz|giriş|sonsöz|içindekiler|prolog|epilog)$/iu;

function buildLines(items: TextItemLike[]): Line[] {
  const lines: Line[] = [];
  let cur: (Line & { endX: number }) | null = null;
  const push = () => {
    if (cur && cur.text.trim()) lines.push({ text: cur.text.trim(), x: cur.x, y: cur.y, size: cur.size });
    cur = null;
  };

  for (const item of items) {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const size = Math.abs(item.height || item.transform[3] || item.transform[0] || 10);
    if (!item.str) {
      if (item.hasEOL) push();
      continue;
    }
    if (cur && Math.abs(y - cur.y) > Math.max(2, Math.min(cur.size, size) * 0.5)) push();
    if (!cur) {
      cur = { text: "", x, y, size, endX: x };
    } else if (item.str.trim()) {
      const gap = x - cur.endX;
      if (gap > size * 0.15 && !cur.text.endsWith(" ") && !item.str.startsWith(" ")) cur.text += " ";
    }
    cur.text += item.str;
    cur.size = Math.max(cur.size, size);
    cur.endX = x + (item.width ?? 0);
    if (item.hasEOL) push();
  }
  push();
  return lines;
}

function bodySizeOf(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const l of lines) {
    const key = Math.round(l.size * 2) / 2;
    weight.set(key, (weight.get(key) ?? 0) + l.text.length);
  }
  let best = lines[0]?.size ?? 10;
  let bestW = -1;
  for (const [size, w] of weight) {
    if (w > bestW) {
      best = size;
      bestW = w;
    }
  }
  return best;
}

export function isHeadingText(text: string, size: number, bodySize: number): boolean {
  const t = text.trim();
  if (!t || t.length > 90) return false;
  if (NUMBERED_HEADING.test(t) || ORDINAL_HEADING.test(t) || NAMED_HEADING.test(t)) return true;
  if (size >= bodySize * 1.25 && !/[,;]$/.test(t)) return true;
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 3 && t.length <= 60 && t === t.toLocaleUpperCase("tr-TR") && !/[.!?,;:]$/.test(t)) {
    return true;
  }
  return false;
}

function joinLines(a: string, b: string): string {
  if (/-$/.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

export function itemsToParagraphs(raw: unknown[]): Paragraph[] {
  const items = raw.filter(
    (it): it is TextItemLike =>
      typeof it === "object" &&
      it !== null &&
      typeof (it as TextItemLike).str === "string" &&
      Array.isArray((it as TextItemLike).transform)
  );
  let lines = buildLines(items);
  if (!lines.length) return [];

  // Sayfa başı/sonundaki yalın sayfa numaralarını at
  if (lines.length > 1 && PAGE_NUMBER.test(lines[lines.length - 1].text)) lines = lines.slice(0, -1);
  if (lines.length > 1 && PAGE_NUMBER.test(lines[0].text)) lines = lines.slice(1);

  const body = bodySizeOf(lines);
  const isHeading = lines.map((l) => isHeadingText(l.text, l.size, body));

  // Sayfanın "normal" satır aralığı: aynı paragraftaki ardışık satırlar arasındaki en küçük boşluk.
  // Geniş satır aralıklı (örn. 1,8×) metinlerde her satırı ayrı paragraf sanmamak için kullanılır.
  let minGap = Infinity;
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0 && !isHeading[i - 1] && !isHeading[i]) minGap = Math.min(minGap, g);
  }

  const paragraphs: Paragraph[] = [];
  let cur: { text: string; heading: boolean } | null = null;
  let prev: Line | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = isHeading[i];
    const gap = prev ? prev.y - line.y : 0;
    const limit = Math.max(line.size * 1.75, Number.isFinite(minGap) ? minGap * 1.45 : 0);
    const farApart = prev ? gap > limit || gap < -line.size : false;

    if (cur && cur.heading && heading && !farApart) {
      // Ardışık başlık satırları tek başlık olur: "BÖLÜM 1" + "Ormandaki Ev"
      cur.text = /[.!?:]$/.test(cur.text) ? `${cur.text} ${line.text}` : `${cur.text}. ${line.text}`;
    } else if (!cur || heading || cur.heading || farApart) {
      if (cur) paragraphs.push({ text: cur.text, heading: cur.heading || undefined });
      cur = { text: line.text, heading };
    } else if (prev && line.x - prev.x > line.size * 1.2 && SENTENCE_PUNCT.test(prev.text)) {
      // Girintili ilk satır: yeni paragraf
      paragraphs.push({ text: cur.text });
      cur = { text: line.text, heading: false };
    } else {
      cur.text = joinLines(cur.text, line.text);
    }
    prev = line;
  }
  if (cur) paragraphs.push({ text: cur.text, heading: cur.heading || undefined });

  return paragraphs
    .map((p) => ({ text: normalizeText(p.text), heading: p.heading }))
    .filter((p) => p.text);
}
