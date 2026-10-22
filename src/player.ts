// Oynatıcı. Android'de kuyruk yerel (Java) tarafta yürür: ekran kilitlense ya da WebView
// duraklatılsa bile parça zinciri kopmaz. Tarayıcıda (geliştirme) Web Speech ile döngü çalışır.
import { NativeTTS, isNative } from "./tts.ts";
import { UserError } from "./lib/errors.ts";
import type { SpeechChunk } from "./lib/speech.ts";

export type PlayOptions = {
  plan: SpeechChunk[];
  startIndex: number;
  rate: number;
  pitch: number;
  volume: number;
  voiceName?: string;
  title: string;
};

export type PlayHandlers = {
  onIndex: (index: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onPaused?: (index: number) => void;
};

let handlers: PlayHandlers | null = null;
let listenersReady: Promise<void> | null = null;
let webSession = 0;
let webIndex = 0;

function ensureNativeListeners(): Promise<void> {
  if (!listenersReady) {
    listenersReady = (async () => {
      await NativeTTS.addListener("chunkStart", (d) => handlers?.onIndex(Number(d.index)));
      await NativeTTS.addListener("queueDone", () => handlers?.onDone());
      await NativeTTS.addListener("queueError", (d) =>
        handlers?.onError(String(d.message || "Android seslendirme işlemi başarısız oldu."))
      );
      await NativeTTS.addListener("playbackPaused", (d) => handlers?.onPaused?.(Number(d.index)));
    })();
  }
  return listenersReady;
}

function speakWeb(text: string, o: PlayOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "tr-TR";
    u.rate = o.rate;
    u.pitch = o.pitch;
    u.volume = o.volume;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.name === o.voiceName) ?? voices.find((v) => v.lang.toLowerCase().startsWith("tr"));
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = (ev) => (ev.error === "canceled" || ev.error === "interrupted" ? resolve() : reject(new UserError("Seslendirme başarısız oldu.")));
    window.speechSynthesis.speak(u);
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export async function play(o: PlayOptions, h: PlayHandlers): Promise<void> {
  if (!o.plan.length) return;
  handlers = h;
  if (isNative()) {
    await ensureNativeListeners();
    try {
      await NativeTTS.speakQueue(o);
    } catch (e) {
      throw new UserError(e instanceof Error && e.message ? e.message : "Seslendirme başlatılamadı.", "NATIVE");
    }
    return;
  }
  if (!("speechSynthesis" in window)) throw new UserError("Bu tarayıcıda seslendirme desteklenmiyor.");
  const session = ++webSession;
  window.speechSynthesis.cancel();
  void (async () => {
    try {
      for (let i = Math.max(0, o.startIndex); i < o.plan.length; i++) {
        if (session !== webSession) return;
        webIndex = i;
        h.onIndex(i);
        for (const seg of o.plan[i]) {
          if (session !== webSession) return;
          await speakWeb(seg.text, o);
          if (seg.pauseAfterMs > 0 && session === webSession) await sleep(seg.pauseAfterMs);
        }
      }
      if (session === webSession) h.onDone();
    } catch (e) {
      if (session === webSession) h.onError(e instanceof Error ? e.message : "Seslendirme başarısız oldu.");
    }
  })();
}

/** Durdurur ve kaldığı parça indeksini döndürür. */
export async function stop(): Promise<number | null> {
  if (isNative()) {
    try {
      const r = await NativeTTS.stop();
      return r.wasPlaying ? r.index : null;
    } catch {
      return null;
    }
  }
  webSession++;
  window.speechSynthesis?.cancel();
  return webIndex;
}

/** Uygulama arka plandan dönünce yerel oynatma durumunu okur. */
export async function getState(): Promise<{ playing: boolean; index: number } | null> {
  if (!isNative()) return null;
  try {
    const s = await NativeTTS.getPlaybackState();
    return { playing: s.playing, index: s.index };
  } catch {
    return null;
  }
}
