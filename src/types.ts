import type { PageContent } from "./lib/text.ts";

/** Kitaplık listesinde kullanılan hafif kayıt. Metin ve PDF dosyası ayrı saklanır. */
export type Book = {
  id: string;
  name: string;
  addedAt: number;
  pageCount: number;
  wordCount: number;
  scannedPages: number;
  chunkCount: number;
  /** PDF parola korumalı ise sayfa görseli için parola yeniden istenir. */
  encrypted: boolean;
  fileSize: number;
  /** Oynatma parçası indeksi (kaldığı yer). */
  progress: number;
};

export type BookText = { id: string; pages: PageContent[] };
