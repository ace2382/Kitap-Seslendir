// Yerel depolama (IndexedDB). Hesap/sunucu yoktur; her şey cihazda kalır.
//  - books: küçük meta kayıtlar (kitaplık listesi ve ilerleme burada)
//  - texts: sayfa sayfa metin
//  - files: özgün PDF (sayfa görselleri istek üzerine buradan çizilir)
// Büyük içerik ile sık güncellenen ilerleme kaydı ayrı tutulur; bu yüzden ilerleme
// kaydetmek artık tüm kitabı yeniden yazmaz ve açılışta yalnızca meta kayıtlar okunur.

import type { Book, BookText } from "./types.ts";
import { UserError } from "./lib/errors.ts";

const DB_NAME = "kitap-seslendir";
const DB_VERSION = 2;
const BOOKS = "books";
const TEXTS = "texts";
const FILES = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new UserError("Bu cihazda yerel kitap depolama desteklenmiyor."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // v1 şeması tüm sayfa görsellerini kitap kaydına gömüyordu; yeni şemaya geçerken sıfırlanır.
      if (event.oldVersion < 2 && db.objectStoreNames.contains(BOOKS)) db.deleteObjectStore(BOOKS);
      for (const name of [BOOKS, TEXTS, FILES]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new UserError("Yerel depolama açılamadı."));
    };
  });
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("İşlem iptal edildi.", "AbortError"));
  });
}

export async function getBooks(): Promise<Book[]> {
  const db = await openDb();
  const all = await req(db.transaction(BOOKS, "readonly").objectStore(BOOKS).getAll() as IDBRequest<Book[]>);
  return all.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getBookText(id: string): Promise<BookText | undefined> {
  const db = await openDb();
  return req(db.transaction(TEXTS, "readonly").objectStore(TEXTS).get(id) as IDBRequest<BookText | undefined>);
}

export async function getBookFile(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  const rec = await req(
    db.transaction(FILES, "readonly").objectStore(FILES).get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>
  );
  return rec?.blob;
}

/** Kitabı, metnini ve PDF'ini tek işlemde (atomik) yazar; yarım kayıt kalmaz. */
export async function saveNewBook(book: Book, text: BookText, file: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([BOOKS, TEXTS, FILES], "readwrite");
  tx.objectStore(BOOKS).put(book);
  tx.objectStore(TEXTS).put(text);
  tx.objectStore(FILES).put({ id: book.id, blob: file });
  await done(tx);
}

export async function updateBook(book: Book): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(BOOKS, "readwrite");
  tx.objectStore(BOOKS).put(book);
  await done(tx);
}

export async function deleteBook(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([BOOKS, TEXTS, FILES], "readwrite");
  tx.objectStore(BOOKS).delete(id);
  tx.objectStore(TEXTS).delete(id);
  tx.objectStore(FILES).delete(id);
  await done(tx);
}

/** Depolamanın silinmesini zorlaştırır ve yer kalıp kalmadığını önceden kontrol eder. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // desteklenmiyorsa sessizce geç
  }
}

export async function assertFreeSpace(neededBytes: number): Promise<void> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota !== undefined && est.usage !== undefined && est.quota - est.usage < neededBytes * 1.5) {
      throw new UserError("Cihazda yeterli boş depolama alanı yok. Yer açıp tekrar dene.", "LOW_DISK");
    }
  } catch (e) {
    if (e instanceof UserError) throw e;
    // estimate() desteklenmiyorsa kontrol atlanır; yazma sırasında QuotaExceededError yakalanır
  }
}
