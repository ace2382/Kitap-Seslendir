import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderPage } from "../pdf.ts";
import { describeError } from "../lib/errors.ts";

type Props = {
  docKey: string;
  page: number;
  encrypted: boolean;
  loadDoc: () => Promise<PDFDocumentProxy | null>;
};

/** Seçili PDF sayfasını istek üzerine çizer. Görseller üzerindeki yazılar okunmaz (OCR yok). */
export default function PdfPageView({ docKey, page, encrypted, loadDoc }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [enabled, setEnabled] = useState(!encrypted);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => setEnabled(!encrypted), [docKey, encrypted]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    setState("loading");
    void (async () => {
      try {
        const doc = await loadDoc();
        if (cancelled) return;
        if (!doc) {
          setState("error");
          setMessage("Sayfa görseli için PDF dosyası bulunamadı.");
          return;
        }
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const width = Math.max(200, Math.min(900, wrap.clientWidth || 360));
        const r = await renderPage(doc, page, canvas, width);
        task = r;
        await r.done;
        if (!cancelled) setState("ready");
      } catch (e) {
        if (cancelled) return;
        if ((e as { name?: string })?.name === "RenderingCancelledException") return;
        setState("error");
        setMessage(describeError(e, "Sayfa görseli çizilemedi."));
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [enabled, page, docKey, loadDoc]);

  if (!enabled) {
    return (
      <div className="page-image-note">
        <button className="secondary-button" onClick={() => setEnabled(true)}>Sayfa görselini göster</button>
        <small>Bu PDF parola korumalı; görseli için parola yeniden istenir.</small>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="page-canvas-wrap">
      {state === "loading" && <div className="page-image-note"><small>Sayfa görseli hazırlanıyor…</small></div>}
      {state === "error" && <div className="page-image-note"><small>{message}</small></div>}
      <canvas
        key={`${docKey}-${page}`}
        ref={canvasRef}
        className="pdf-page-canvas"
        hidden={state !== "ready"}
        role="img"
        aria-label={`${page}. PDF sayfası`}
      />
    </div>
  );
}
