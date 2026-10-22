import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import PasswordDialog from "./components/PasswordDialog.tsx";
import PdfPageView from "./components/PdfPageView.tsx";
import { UserError, describeError } from "./lib/errors.ts";
import { buildChunks, estimateMinutes, fnv1a } from "./lib/text.ts";
import type { PageContent } from "./lib/text.ts";
import { importPdf, openPdf } from "./pdf.ts";
import { getState, play, stop } from "./player.ts";
import type { PlayHandlers } from "./player.ts";
import {
  assertFreeSpace,
  deleteBook,
  getBookFile,
  getBookText,
  getBooks,
  requestPersistence,
  saveNewBook,
  updateBook
} from "./storage.ts";
import {
  cancelExport,
  deleteAudio,
  exportAudio,
  getAudioInfo,
  getTtsStatus,
  isNative,
  openVoiceSettings,
  saveAudio,
  shareAudio
} from "./tts.ts";
import type { AudioInfo, TtsStatus, VoiceInfo } from "./tts.ts";
import type { Book } from "./types.ts";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* depolama kapalıysa ayarlar yalnızca oturum boyunca geçerli olur */
  }
}

function voiceLabel(v: VoiceInfo, index: number): string {
  const tags: string[] = [];
  if (v.genderHint === "female") tags.push("kadın");
  if (v.genderHint === "male") tags.push("erkek");
  tags.push(v.networkRequired ? "çevrimiçi olabilir" : "çevrimdışı");
  return `Ses ${index + 1} · ${tags.join(" · ")} (${v.name})`;
}

const formatMb = (bytes?: number) => `${((bytes ?? 0) / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
const formatDuration = (ms?: number) => {
  const total = Math.round((ms ?? 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${Math.max(1, m)} dk`;
};

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pages, setPages] = useState<PageContent[] | null>(null);
  const [tts, setTts] = useState<TtsStatus | null>(null);
  const [voiceName, setVoiceName] = useState(() => readPref("ks.voice", ""));
  const [rate, setRate] = useState(() => Number(readPref("ks.rate", "1")) || 1);
  const [pitch, setPitch] = useState(() => Number(readPref("ks.pitch", "1")) || 1);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [selectedPage, setSelectedPage] = useState(1);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [audio, setAudio] = useState<AudioInfo | null>(null);
  const [pwRequest, setPwRequest] = useState<{ wasIncorrect: boolean; resolve: (v: string | null) => void } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const importAbort = useRef<AbortController | null>(null);
  const bookRef = useRef<Book | null>(null);
  const docPromise = useRef<{ id: string; p: Promise<PDFDocumentProxy | null> } | null>(null);

  const activeBook = useMemo(() => books.find((b) => b.id === activeId) ?? null, [books, activeId]);
  bookRef.current = activeBook;

  const { chunks, sections } = useMemo(() => (pages ? buildChunks(pages) : { chunks: [], sections: [] }), [pages]);
  const chunkTexts = useMemo(() => chunks.map((c) => c.text), [chunks]);
  const signature = useMemo(
    () => fnv1a(`${voiceName}|${rate}|${pitch}|${fnv1a(chunkTexts.join("\u0001"))}`),
    [voiceName, rate, pitch, chunkTexts]
  );
  const selectedVoice = tts?.voices.find((v) => v.name === voiceName);
  const currentChunk = chunks[current];
  const currentSection = currentChunk && currentChunk.section >= 0 ? sections[currentChunk.section] : undefined;
  const percent = chunks.length ? Math.round((current / chunks.length) * 100) : 0;

  // ---------------------------------------------------------------- başlangıç ve durum

  const refreshTts = useCallback(async () => {
    const status = await getTtsStatus();
    setTts(status);
    setVoiceName((cur) => {
      if (cur && status.voices.some((v) => v.name === cur)) return cur;
      return status.voices[0]?.name ?? "";
    });
  }, []);

  useEffect(() => {
    void requestPersistence();
    void (async () => {
      try {
        setBooks(await getBooks());
      } catch (e) {
        setError(describeError(e, "Kitaplık açılamadı."));
      }
      await refreshTts();
    })();
  }, [refreshTts]);

  useEffect(() => writePref("ks.voice", voiceName), [voiceName]);
  useEffect(() => writePref("ks.rate", String(rate)), [rate]);
  useEffect(() => writePref("ks.pitch", String(pitch)), [pitch]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const persistProgress = useCallback((index: number) => {
    const book = bookRef.current;
    if (!book) return;
    const updated = { ...book, progress: index };
    bookRef.current = updated;
    setBooks((all) => all.map((b) => (b.id === updated.id ? updated : b)));
    void updateBook(updated).catch(() => undefined); // yalnızca küçük meta kaydı yazılır
  }, []);

  // Ekran kilitlenip açılınca / uygulamaya dönülünce yerel oynatma durumunu eşitle.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void getState().then((s) => {
        if (!s) return;
        setPlaying(s.playing);
        if (s.playing) {
          setCurrent(s.index);
          persistProgress(s.index);
        }
      });
      void refreshTts();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [persistProgress, refreshTts]);

  // Oynarken sayfa görüntüsü dinlenen sayfayı izler.
  useEffect(() => {
    if (playing && currentChunk) setSelectedPage(currentChunk.page);
  }, [playing, currentChunk]);

  // Ses dosyası önbelleği: kitap/ses/hız değişince yeniden sorgula.
  useEffect(() => {
    setAudio(null);
    if (!activeId || !chunks.length) return;
    let cancelled = false;
    void getAudioInfo(activeId, signature).then((info) => {
      if (!cancelled) setAudio(info);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, signature, chunks.length]);

  // ---------------------------------------------------------------- PDF görseli (istek üzerine)

  const askPassword = useCallback(
    (wasIncorrect: boolean) => new Promise<string | null>((resolve) => setPwRequest({ wasIncorrect, resolve })),
    []
  );

  const loadDoc = useCallback((): Promise<PDFDocumentProxy | null> => {
    if (!activeId) return Promise.resolve(null);
    if (docPromise.current?.id === activeId) return docPromise.current.p;
    const p = (async () => {
      const blob = await getBookFile(activeId);
      if (!blob) return null;
      return (await openPdf(blob, askPassword)).doc;
    })();
    docPromise.current = { id: activeId, p };
    p.catch(() => {
      if (docPromise.current?.p === p) docPromise.current = null; // başarısız/iptal: yeniden denenebilsin
    });
    return p;
  }, [activeId, askPassword]);

  useEffect(
    () => () => {
      const held = docPromise.current;
      docPromise.current = null;
      void held?.p.then((d) => d?.destroy()).catch(() => undefined);
    },
    [activeId]
  );

  // ---------------------------------------------------------------- oynatma

  const handlers = useMemo<PlayHandlers>(
    () => ({
      onIndex: (i) => {
        setCurrent(i);
        persistProgress(i);
      },
      onDone: () => {
        setPlaying(false);
        setCurrent(0);
        persistProgress(0);
        setNotice("Kitap bitti. İstediğinde yeniden dinleyebilirsin.");
      },
      onError: (message) => {
        setPlaying(false);
        setError(message);
      },
      onPaused: (i) => {
        setPlaying(false);
        setCurrent(i);
        persistProgress(i);
        setNotice("Seslendirme duraklatıldı.");
      }
    }),
    [persistProgress]
  );

  const startPlayback = useCallback(
    async (index: number) => {
      const book = bookRef.current;
      if (!book || !chunkTexts.length) return;
      if (tts && !tts.ready) {
        setError("Android metin okuma motoru hazır değil. Ses ayarlarından bir motor seçip tekrar dene.");
        return;
      }
      const start = clamp(index, 0, chunkTexts.length - 1);
      setError("");
      setPlaying(true);
      setCurrent(start);
      try {
        await play(
          { chunks: chunkTexts, startIndex: start, rate, pitch, voiceName: voiceName || undefined, title: book.name },
          handlers
        );
        persistProgress(start);
      } catch (e) {
        setPlaying(false);
        setError(describeError(e, "Seslendirme başlatılamadı."));
      }
    },
    [chunkTexts, tts, rate, pitch, voiceName, handlers, persistProgress]
  );

  const pause = useCallback(async () => {
    const index = await stop();
    setPlaying(false);
    if (index !== null && index !== undefined) {
      setCurrent(index);
      persistProgress(index);
    }
  }, [persistProgress]);

  const seek = (delta: number) => {
    const target = clamp(current + delta, 0, Math.max(0, chunks.length - 1));
    if (playing) void startPlayback(target);
    else {
      setCurrent(target);
      persistProgress(target);
    }
  };

  const jumpToChunk = (index: number) => {
    if (playing) void startPlayback(index);
    else {
      setCurrent(index);
      persistProgress(index);
    }
  };

  const playFromSelectedPage = () => {
    const index = chunks.findIndex((c) => c.page >= selectedPage);
    if (index < 0) {
      setNotice("Bu sayfadan sonra okunacak metin yok.");
      return;
    }
    void startPlayback(index);
  };

  const trySample = async () => {
    await pause();
    setError("");
    try {
      await play(
        {
          chunks: ["Merhaba! Ben senin hikâyeni okuyacağım. Bu sesi beğendin mi?"],
          startIndex: 0,
          rate,
          pitch,
          voiceName: voiceName || undefined,
          title: "Ses denemesi"
        },
        { onIndex: () => undefined, onDone: () => undefined, onError: (m) => setError(m) }
      );
    } catch (e) {
      setError(describeError(e, "Ses denemesi başlatılamadı."));
    }
  };

  // ---------------------------------------------------------------- kitaplık

  const openBook = async (book: Book) => {
    if (playing) await pause();
    setError("");
    setLibraryOpen(false);
    try {
      const text = await getBookText(book.id);
      if (!text) throw new UserError("Kitabın metni bulunamadı. Kitabı silip PDF'i yeniden ekle.");
      setPages(text.pages);
      setActiveId(book.id);
      const start = clamp(book.progress || 0, 0, Math.max(0, book.chunkCount - 1));
      setCurrent(start);
      const pageOfStart = buildChunks(text.pages).chunks[start]?.page ?? text.pages[0]?.page ?? 1;
      setSelectedPage(pageOfStart);
    } catch (e) {
      setError(describeError(e, "Kitap açılamadı."));
    }
  };

  const leaveBook = async () => {
    if (playing) await pause();
    setActiveId(null);
    setPages(null);
    setLibraryOpen(false);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setError("");
    setNotice("");
    const abort = new AbortController();
    importAbort.current = abort;
    setImporting({ done: 0, total: 0 });
    try {
      await assertFreeSpace(file.size);
      const parsed = await importPdf(file, {
        askPassword,
        signal: abort.signal,
        onProgress: (done, total) => setImporting({ done, total })
      });
      const built = buildChunks(parsed.pages);
      const book: Book = {
        id: uid(),
        name: file.name.replace(/\.pdf$/i, "").trim() || "Adsız kitap",
        addedAt: Date.now(),
        pageCount: parsed.pages.length,
        wordCount: parsed.wordCount,
        scannedPages: parsed.scannedPages,
        chunkCount: built.chunks.length,
        encrypted: parsed.encrypted,
        fileSize: file.size,
        progress: 0
      };
      await saveNewBook(book, { id: book.id, pages: parsed.pages }, file);
      setBooks(await getBooks());
      await openBook(book);
      setNotice(
        parsed.scannedPages
          ? `“${book.name}” eklendi. ${parsed.scannedPages} sayfada seçilebilir metin yoktu; bu sayfalarda OCR kullanılmadı.`
          : `“${book.name}” kitaplığına eklendi.`
      );
    } catch (e) {
      if (!(e instanceof UserError && e.code === "CANCELLED")) setError(describeError(e, "PDF okunamadı."));
      else setNotice("İçe aktarma iptal edildi.");
    } finally {
      importAbort.current = null;
      setImporting(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeBook = async (book: Book) => {
    if (!window.confirm(`“${book.name}” kitaplıktan silinsin mi? Bu kitaba ait ses dosyası da silinir.`)) return;
    if (activeId === book.id) await leaveBook();
    try {
      await deleteBook(book.id);
      await deleteAudio(book.id);
      setBooks((all) => all.filter((b) => b.id !== book.id));
      setNotice("Kitap cihazdan silindi.");
    } catch (e) {
      setError(describeError(e, "Kitap silinemedi."));
    }
  };

  // ---------------------------------------------------------------- ses dosyası

  const makeAudio = async () => {
    const book = bookRef.current;
    if (!book || !chunkTexts.length) return;
    await pause();
    setError("");
    setExporting({ done: 0, total: chunkTexts.length });
    try {
      const result = await exportAudio(
        { bookId: book.id, title: book.name, signature, chunks: chunkTexts, rate, pitch, voiceName: voiceName || undefined },
        (done, total) => setExporting({ done, total })
      );
      setAudio({ exists: true, matches: true, ...result });
      setNotice("Ses dosyası hazır.");
    } catch (e) {
      if (e instanceof UserError && e.code === "CANCELLED") setNotice("Ses dosyası oluşturma iptal edildi.");
      else setError(describeError(e, "Ses dosyası oluşturulamadı."));
    } finally {
      setExporting(null);
    }
  };

  const saveAudioFile = async () => {
    if (!activeBook) return;
    try {
      const r = await saveAudio(activeBook.id, activeBook.name);
      setNotice(`Ses dosyası “${r.folder}” klasörüne kaydedildi.`);
    } catch (e) {
      const code = e instanceof UserError ? e.code : "";
      setError(
        code === "UNSUPPORTED_API"
          ? "Android 9 ve altında doğrudan kaydetme yok. “Paylaş” ile dosyayı bir klasöre kaydedebilirsin."
          : describeError(e, "Ses dosyası kaydedilemedi.")
      );
    }
  };

  const shareAudioFile = async () => {
    if (!activeBook) return;
    try {
      await shareAudio(activeBook.id, activeBook.name, audio?.uri);
    } catch (e) {
      setError(describeError(e, "Paylaşım açılamadı."));
    }
  };

  const shareText = async () => {
    const page = pages?.find((p) => p.page === selectedPage);
    const text = page?.paragraphs.map((p) => p.text).join("\n\n") ?? "";
    if (!activeBook || !text) return;
    try {
      await Share.share({ title: `${activeBook.name} — sayfa ${selectedPage}`, text, dialogTitle: "Sayfa metnini paylaş" });
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setNotice("Sayfa metni panoya kopyalandı.");
      } catch {
        setError("Paylaşım açılamadı. Cihazın paylaşım özelliklerini kontrol et.");
      }
    }
  };

  const fixVoices = async () => {
    try {
      await openVoiceSettings();
    } catch (e) {
      setError(describeError(e, "Ses ayarları açılamadı."));
    }
  };

  // ---------------------------------------------------------------- görünüm

  const pageContent = pages?.find((p) => p.page === selectedPage);
  const noTurkish = tts?.ready && (tts.turkish !== "available" || tts.voices.length === 0);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); void leaveBook(); }}>
          <span className="brand-mark" aria-hidden="true">K</span>
          <span><strong>kitap</strong><b>seslendir</b><small>Hikâyeler kulağında</small></span>
        </a>
        <button className="icon-button" aria-label="Kitaplığım" onClick={() => setLibraryOpen((v) => !v)}>▤</button>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="live-dot" /> TAMAMEN CİHAZINDA</div>
        <h1>Hikâyeni<br /><em>dinlemeye</em> başla.</h1>
        <p>PDF’ni seç, rahatına bak. Hikâyen internet gerekmeden seninle.</p>
        {importing ? (
          <div className="inline-progress" role="status">
            <div className="progress-label">
              <span>{importing.total ? `Sayfa ${importing.done} / ${importing.total} okunuyor…` : "PDF açılıyor…"}</span>
              <button className="text-button" onClick={() => importAbort.current?.abort()}>İptal</button>
            </div>
            <div className="progress-track"><div style={{ width: `${importing.total ? Math.round((importing.done / importing.total) * 100) : 4}%` }} /></div>
          </div>
        ) : (
          <button className="primary-button" onClick={() => fileRef.current?.click()}>
            <span className="button-symbol">＋</span>PDF kitabı ekle
          </button>
        )}
        <input ref={fileRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={(e) => void importFile(e.target.files?.[0])} />
        <div className="privacy-note"><span>♧</span> Dosyaların hiçbir yere yüklenmez.</div>
      </section>

      {error && <div className="message error-message" role="alert"><span>!</span><div>{error}</div><button onClick={() => setError("")} aria-label="Uyarıyı kapat">×</button></div>}
      {notice && <div className="message notice-message" role="status"><span>✓</span><div>{notice}</div><button onClick={() => setNotice("")} aria-label="Bildirimi kapat">×</button></div>}

      {activeBook && pages ? (
        <section className="reader-panel">
          <div className="section-heading">
            <div><span className="eyebrow">ŞİMDİ DİNLİYORSUN</span><h2>{activeBook.name}</h2></div>
            <button className="text-button" onClick={() => void leaveBook()}>Kitaplığa dön</button>
          </div>

          <div className="book-summary">
            <div className="cover"><span className="cover-sun" /><span className="cover-leaf">❧</span><span className="cover-title">{activeBook.name.slice(0, 42)}</span><small>KİTAP SESLENDİR</small></div>
            <div className="summary-copy">
              <strong>{activeBook.pageCount} sayfa</strong>
              <span>Yaklaşık {estimateMinutes(activeBook.wordCount, rate)} dk dinleme</span>
              <span>{activeBook.wordCount.toLocaleString("tr-TR")} kelime{sections.length ? ` · ${sections.length} bölüm` : ""}</span>
              {activeBook.scannedPages > 0 && <span className="scan-note">{activeBook.scannedPages} sayfada metin yok (OCR yok)</span>}
            </div>
          </div>

          <div className="player-card">
            <div className="player-top">
              <span className="sound-wave">♫</span>
              <div><strong>{playing ? "Hikâyen anlatılıyor" : "Dinlemeye hazır"}</strong><small>{playing ? "Ekran kilitlense de devam eder" : "Kaldığın yerden devam et"}</small></div>
              <span className="offline-pill">ÇEVRİMDIŞI</span>
            </div>
            <div className="progress-label"><span>İlerleme</span><span>{percent}%</span></div>
            <div className="progress-track"><div style={{ width: `${percent}%` }} /></div>
            <div className="player-controls">
              <button className="round-control" aria-label="Önceki parça" disabled={!!exporting} onClick={() => seek(-1)}>↶</button>
              {playing
                ? <button className="play-button" aria-label="Duraklat" onClick={() => void pause()}>Ⅱ</button>
                : <button className="play-button" aria-label="Oynat" disabled={!!exporting || !chunks.length} onClick={() => void startPlayback(current)}>▶</button>}
              <button className="round-control" aria-label="Sonraki parça" disabled={!!exporting} onClick={() => seek(1)}>↷</button>
            </div>
            <div className="player-caption">
              {chunks.length ? `Parça ${Math.min(current + 1, chunks.length)} / ${chunks.length} · Sayfa ${currentChunk?.page ?? 1}` : "Okunacak metin yok"}
              {currentSection ? ` · ${currentSection.title}` : ""}
            </div>
            {sections.length > 0 && (
              <>
                <label className="field-label spaced" htmlFor="section">Bölüme git</label>
                <select id="section" value={currentChunk && currentChunk.section >= 0 ? currentChunk.section : ""} onChange={(e) => { const s = sections[Number(e.target.value)]; if (s) jumpToChunk(s.chunk); }}>
                  {(!currentChunk || currentChunk.section < 0) && <option value="">Bölüm seç…</option>}
                  {sections.map((s, i) => <option key={`${s.page}-${i}`} value={i}>{s.title} (s. {s.page})</option>)}
                </select>
              </>
            )}
          </div>

          <div className="settings-card">
            <div className="settings-title"><span>☷</span><div><strong>Ses ayarları</strong><small>Sesleri dinleyip kendine uygun olanı seç</small></div></div>

            {tts && !tts.ready && (
              <div className="voice-warning">
                Android metin okuma motoru hazır değil{tts.reason === "timeout" ? " (zaman aşımı)" : ""}. Ayarlar → Metin okuma çıkışı bölümünden bir motor etkinleştir.
                <div className="warning-actions"><button className="text-button" onClick={() => void fixVoices()}>Ses ayarlarını aç</button><button className="text-button" onClick={() => void refreshTts()}>Yeniden kontrol et</button></div>
              </div>
            )}
            {noTurkish && (
              <div className="voice-warning">
                Cihazında kullanılabilir Türkçe ses bulunamadı. Ses verisini yükledikten sonra buraya dön; liste kendiliğinden yenilenir.
                <div className="warning-actions"><button className="text-button" onClick={() => void fixVoices()}>Türkçe ses verisini yükle</button><button className="text-button" onClick={() => void refreshTts()}>Yeniden kontrol et</button></div>
              </div>
            )}

            <label className="field-label" htmlFor="voice">Türkçe ses</label>
            <select id="voice" value={voiceName} onChange={(e) => setVoiceName(e.target.value)} disabled={playing || !!exporting}>
              {(!tts || tts.voices.length === 0) && <option value="">Cihaz varsayılan sesi</option>}
              {tts?.voices.map((v, i) => <option value={v.name} key={v.name}>{voiceLabel(v, i)}</option>)}
            </select>
            <div className="voice-row">
              <button className="secondary-button" disabled={!tts?.ready || !!exporting} onClick={() => void trySample()}>▶ Sesi dene</button>
              <small>Android ses cinsiyetini bildirmez; kadın/erkek bilgisi yalnızca ses adında yazıyorsa gösterilir.</small>
            </div>
            {selectedVoice?.networkRequired && <div className="voice-warning">Seçili ses internet gerektirebilir. Tam çevrimdışı kullanım için “çevrimdışı” etiketli bir ses seç.</div>}

            <div className="range-field"><div><label htmlFor="rate">Konuşma hızı</label><output>{rate.toFixed(1)}×</output></div><input id="rate" type="range" min="0.6" max="1.4" step="0.1" value={rate} onChange={(e) => setRate(Number(e.target.value))} disabled={playing || !!exporting} /><div className="range-ends"><span>Yavaş</span><span>Hızlı</span></div></div>
            <div className="range-field"><div><label htmlFor="pitch">Ses perdesi</label><output>{pitch.toFixed(1)}</output></div><input id="pitch" type="range" min="0.7" max="1.3" step="0.1" value={pitch} onChange={(e) => setPitch(Number(e.target.value))} disabled={playing || !!exporting} /><div className="range-ends"><span>Kalın</span><span>İnce</span></div></div>
          </div>

          <div className="audio-card">
            <div className="settings-title"><span>♪</span><div><strong>Ses dosyası</strong><small>Kitabı cihazında dosya olarak oluştur (M4A)</small></div></div>
            {!isNative() ? (
              <p className="audio-note">Ses dosyası oluşturma yalnızca Android uygulamasında çalışır.</p>
            ) : exporting ? (
              <div className="inline-progress" role="status">
                <div className="progress-label"><span>Parça {exporting.done} / {exporting.total} hazırlanıyor…</span><button className="text-button" onClick={() => void cancelExport()}>İptal</button></div>
                <div className="progress-track"><div style={{ width: `${Math.round((exporting.done / Math.max(1, exporting.total)) * 100)}%` }} /></div>
                <p className="audio-note">Uzun kitaplar birkaç dakika sürebilir. Uygulamayı açık tut.</p>
              </div>
            ) : audio?.exists && audio.matches && audio.uri ? (
              <>
                <audio className="audio-player" controls preload="none" src={Capacitor.convertFileSrc(audio.uri)} />
                <p className="audio-note">{formatDuration(audio.durationMs)} · {formatMb(audio.bytes)} · cihaz önbelleğinde</p>
                <div className="audio-actions">
                  <button className="secondary-button" onClick={() => void saveAudioFile()}>Müziğe kaydet</button>
                  <button className="secondary-button" onClick={() => void shareAudioFile()}>Paylaş</button>
                </div>
              </>
            ) : (
              <>
                {audio?.exists && !audio.matches && <p className="audio-note">Ses, hız veya metin değişti; mevcut dosya eskidi. Yeniden oluştur.</p>}
                <button className="secondary-button" disabled={!tts?.ready || !chunks.length} onClick={() => void makeAudio()}>Ses dosyası oluştur</button>
              </>
            )}
          </div>

          <div className="page-card">
            <div className="section-heading compact">
              <div><span className="eyebrow">KİTAP OKUYUCU</span><h3>Sayfa önizlemesi</h3></div>
              <div className="page-nav">
                <button aria-label="Önceki sayfa" onClick={() => setSelectedPage((p) => Math.max(1, p - 1))} disabled={selectedPage <= 1}>‹</button>
                <span>{selectedPage} / {activeBook.pageCount}</span>
                <button aria-label="Sonraki sayfa" onClick={() => setSelectedPage((p) => Math.min(activeBook.pageCount, p + 1))} disabled={selectedPage >= activeBook.pageCount}>›</button>
              </div>
            </div>
            <PdfPageView docKey={activeBook.id} page={selectedPage} encrypted={activeBook.encrypted} loadDoc={loadDoc} />
            <article className="page-text">
              {pageContent && pageContent.paragraphs.length
                ? pageContent.paragraphs.map((p, i) => p.heading ? <h4 className="page-heading" key={i}>{p.text}</h4> : <p key={i}>{p.text}</p>)
                : "Bu sayfada seçilebilir metin bulunamadı. Taranmış yazılar OCR ile okunmaz."}
            </article>
            <div className="page-actions">
              <button className="secondary-button" disabled={!!exporting || !pageContent?.paragraphs.length} onClick={playFromSelectedPage}>Bu sayfadan oku</button>
              <button className="text-button" disabled={!pageContent?.paragraphs.length} onClick={() => void shareText()}>Sayfa metnini paylaş ↗</button>
            </div>
          </div>

          <div className="reader-actions"><button className="danger-text" onClick={() => void removeBook(activeBook)}>Kitabı sil</button></div>
        </section>
      ) : (
        <section className="library-section">
          {libraryOpen && <div className="section-heading"><div><span className="eyebrow">KÜTÜPHANEN</span><h2>Kitaplığım</h2></div><button className="text-button" onClick={() => setLibraryOpen(false)}>Kapat ×</button></div>}
          <div className="section-heading"><div><span className="eyebrow">KÜÇÜK BİR KAÇIŞ</span><h2>{books.length ? "Kaldığın yerden." : "Sana ait bir dünya."}</h2></div>{books.length > 0 && <span className="count-pill">{books.length} kitap</span>}</div>
          {books.length ? (
            <div className="book-grid">
              {books.map((book, index) => (
                <article className="library-book" key={book.id}>
                  <button className={`mini-cover cover-tone-${index % 3}`} onClick={() => void openBook(book)} aria-label={`${book.name} kitabını aç`}><span>❧</span><strong>{book.name.slice(0, 38)}</strong><small>{book.pageCount} SAYFA</small></button>
                  <div className="library-book-copy">
                    <button className="book-title-button" onClick={() => void openBook(book)}>{book.name}</button>
                    <span>{estimateMinutes(book.wordCount)} dk · {book.progress && book.chunkCount ? `%${Math.round((book.progress / book.chunkCount) * 100)} dinlendi` : "Henüz dinlenmedi"}</span>
                    <div><button className="text-button" onClick={() => void openBook(book)}>Dinle →</button><button className="danger-text" onClick={() => void removeBook(book)}>Sil</button></div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state"><div className="empty-art"><span>✳</span><span>♫</span><span>✧</span></div><h3>Bir sonraki hikâyen burada.</h3><p>İlk PDF’ni ekle, kendi küçük sesli kitaplığını oluştur.</p><button className="secondary-button" onClick={() => fileRef.current?.click()}>İlk kitabını ekle</button></div>
          )}
          <div className="feature-strip"><div><span>⌁</span><strong>İnternetsiz</strong><small>Uçak modunda bile*</small></div><div><span>♧</span><strong>Özel</strong><small>Dosyaların cihazında</small></div><div><span>♡</span><strong>Ücretsiz</strong><small>Hesap gerekmez</small></div></div>
          <p className="footnote">* PDF okuma çevrimdışıdır. Seslendirme için cihazında çevrimdışı Türkçe ses verisi yüklü olmalıdır.</p>
        </section>
      )}

      <footer className="footer"><span className="brand-mark small">K</span><span>Bir hikâye, bir nefes.</span><span className="footer-lock">⌑ Verilerin cihazında</span></footer>

      {pwRequest && (
        <PasswordDialog
          wasIncorrect={pwRequest.wasIncorrect}
          onSubmit={(pw) => { pwRequest.resolve(pw); setPwRequest(null); }}
          onCancel={() => { pwRequest.resolve(null); setPwRequest(null); }}
        />
      )}
    </main>
  );
}
