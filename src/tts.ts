// Android TextToSpeech köprüsü (NativeTTS eklentisi) + tarayıcıda geliştirme için Web Speech yedeği.
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { UserError } from "./lib/errors.ts";
import type { SpeechChunk } from "./lib/speech.ts";

export type VoiceInfo = {
  name: string;
  language: string;
  quality: number;
  networkRequired: boolean;
  /** Android ses cinsiyeti bilgisi vermez; yalnızca adında açıkça yazıyorsa "female"/"male". */
  genderHint: "female" | "male" | "unknown";
};

export type TurkishSupport = "available" | "missing_data" | "not_supported" | "unknown";

export type TtsStatus = {
  ready: boolean;
  native: boolean;
  engine: string;
  turkish: TurkishSupport;
  voices: VoiceInfo[];
  reason?: string;
};

export type AudioInfo = {
  exists: boolean;
  matches: boolean;
  bytes?: number;
  uri?: string;
  fileName?: string;
  durationMs?: number;
};

type QueueOptions = {
  /** Her parça: paragraf metinleri ve ardından beklenecek süre (ms). */
  plan: SpeechChunk[];
  startIndex: number;
  rate: number;
  pitch: number;
  /** 0.1–1.0; Android'de medya sesine göre ölçeklenir, onu aşamaz. */
  volume: number;
  voiceName?: string;
  title: string;
};

type ExportOptions = {
  bookId: string;
  title: string;
  signature: string;
  plan: SpeechChunk[];
  rate: number;
  pitch: number;
  /** Ses dosyasında örneklere uygulanan kazanç (0.1–1.0). */
  volume: number;
  voiceName?: string;
};

type ListenerFn = (data: Record<string, unknown>) => void;

interface NativeTTSPlugin {
  getStatus(): Promise<TtsStatus>;
  speakQueue(o: QueueOptions): Promise<{ started: boolean }>;
  stop(): Promise<{ index: number; wasPlaying: boolean }>;
  getPlaybackState(): Promise<{ playing: boolean; index: number; total: number }>;
  exportAudio(o: ExportOptions): Promise<Required<Omit<AudioInfo, "exists" | "matches">>>;
  cancelExport(): Promise<void>;
  getAudioInfo(o: { bookId: string; signature: string }): Promise<AudioInfo>;
  deleteAudio(o: { bookId: string }): Promise<void>;
  saveAudio(o: { bookId: string; title: string }): Promise<{ uri: string; folder: string }>;
  shareAudio(o: { bookId: string; title: string }): Promise<void>;
  openVoiceSettings(): Promise<void>;
  addListener(event: string, fn: ListenerFn): Promise<PluginListenerHandle>;
}

export const NativeTTS = registerPlugin<NativeTTSPlugin>("NativeTTS");
export const isNative = () => Capacitor.isNativePlatform();

async function call<T>(p: Promise<T>, fallback: string): Promise<T> {
  try {
    return await p;
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : fallback;
    const code = (e as { code?: unknown } | null)?.code;
    throw new UserError(message, typeof code === "string" ? code : "NATIVE");
  }
}

function sortVoices(voices: VoiceInfo[]): VoiceInfo[] {
  const rank = (v: VoiceInfo) =>
    (v.networkRequired ? 0 : 1000) + v.quality + (v.genderHint === "female" ? 50 : 0);
  return [...voices].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
}

export async function getTtsStatus(): Promise<TtsStatus> {
  if (isNative()) {
    try {
      const s = await NativeTTS.getStatus();
      return { ...s, voices: sortVoices(s.voices ?? []) };
    } catch {
      return { ready: false, native: true, engine: "", turkish: "unknown", voices: [], reason: "error" };
    }
  }
  if (!("speechSynthesis" in window)) {
    return { ready: false, native: false, engine: "", turkish: "not_supported", voices: [], reason: "no_engine" };
  }
  let list = window.speechSynthesis.getVoices();
  if (!list.length) {
    await new Promise<void>((resolve) => {
      const t = window.setTimeout(resolve, 1000);
      window.speechSynthesis.addEventListener("voiceschanged", () => { window.clearTimeout(t); resolve(); }, { once: true });
    });
    list = window.speechSynthesis.getVoices();
  }
  const voices: VoiceInfo[] = list
    .filter((v) => v.lang.toLowerCase().startsWith("tr"))
    .map((v) => ({ name: v.name, language: v.lang, quality: 0, networkRequired: !v.localService, genderHint: "unknown" as const }));
  return {
    ready: true,
    native: false,
    engine: "Tarayıcı (yalnızca geliştirme önizlemesi)",
    turkish: voices.length ? "available" : "not_supported",
    voices: sortVoices(voices)
  };
}

export async function openVoiceSettings(): Promise<void> {
  if (!isNative()) throw new UserError("Ses ayarları yalnızca Android uygulamasında açılır.");
  await call(NativeTTS.openVoiceSettings(), "Ses ayarları açılamadı. Android Ayarlar → Metin okuma çıkışı bölümüne git.");
}

// ---- Ses dosyası (M4A/AAC) dışa aktarma ve önbellek ----

export async function getAudioInfo(bookId: string, signature: string): Promise<AudioInfo> {
  if (!isNative()) return { exists: false, matches: false };
  try {
    return await NativeTTS.getAudioInfo({ bookId, signature });
  } catch {
    return { exists: false, matches: false };
  }
}

export async function exportAudio(o: ExportOptions, onProgress: (done: number, total: number) => void) {
  if (!isNative()) throw new UserError("Ses dosyası oluşturma yalnızca Android uygulamasında kullanılabilir.");
  const handle = await NativeTTS.addListener("exportProgress", (d) => onProgress(Number(d.done), Number(d.total)));
  try {
    return await call(NativeTTS.exportAudio(o), "Ses dosyası oluşturulamadı.");
  } finally {
    await handle.remove();
  }
}

export async function cancelExport(): Promise<void> {
  if (isNative()) await NativeTTS.cancelExport().catch(() => undefined);
}

export async function deleteAudio(bookId: string): Promise<void> {
  if (isNative()) await NativeTTS.deleteAudio({ bookId }).catch(() => undefined);
}

export async function saveAudio(bookId: string, title: string): Promise<{ uri: string; folder: string }> {
  return call(NativeTTS.saveAudio({ bookId, title }), "Ses dosyası kaydedilemedi.");
}

/** Android 10+ için MediaStore üzerinden paylaşır; eski sürümlerde dosya URL'siyle dener. */
export async function shareAudio(bookId: string, title: string, fallbackFileUri?: string): Promise<void> {
  try {
    await NativeTTS.shareAudio({ bookId, title });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "UNSUPPORTED_API" && fallbackFileUri) {
      await Share.share({ title, url: fallbackFileUri, dialogTitle: "Ses dosyasını paylaş" });
      return;
    }
    throw new UserError(e instanceof Error && e.message ? e.message : "Paylaşım açılamadı.", "NATIVE");
  }
}
