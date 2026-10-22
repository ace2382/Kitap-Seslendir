package com.kitapseslendir.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Android yerleşik TextToSpeech motoru köprüsü (çevrimdışı çalışır, bulut TTS yok).
 *
 * - Oynatma kuyruğu bu sınıfta yürür: JS (WebView) arka plana alınsa da parça zinciri kopmaz.
 * - Ses dosyası dışa aktarma: TTS -> WAV (geçici) -> AAC (MediaCodec) -> .m4a. Harici kütüphane yok.
 * - Kaydetme/paylaşma MediaStore üzerinden yapılır (Android 10+ için depolama izni gerekmez).
 */
@CapacitorPlugin(name = "NativeTTS")
public class NativeTTSPlugin extends Plugin {
    private static final String TAG = "NativeTTS";
    private static final Locale TR = Locale.forLanguageTag("tr-TR");
    private static final int MAX_AHEAD = 3;
    private static final long INIT_TIMEOUT_MS = 6000;
    private static final long SYNTH_TIMEOUT_MS = 180_000;

    private static volatile NativeTTSPlugin instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object lock = new Object();
    private final List<PluginCall> pendingStatus = new ArrayList<>();
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, ExportWait> exportWaits = new ConcurrentHashMap<>();
    private final AtomicBoolean exporting = new AtomicBoolean(false);
    private volatile boolean cancelExport = false;

    private TextToSpeech tts;
    private volatile boolean ready = false;
    private volatile boolean initFinished = false;
    private volatile boolean timedOut = false;
    private volatile int turkishResult = TextToSpeech.LANG_NOT_SUPPORTED;

    // Oynatma kuyruğu durumu ("lock" ile korunur)
    private List<String> queue = new ArrayList<>();
    private int nextToEnqueue = 0;
    private int currentIndex = 0;
    private int session = 0;
    private boolean playing = false;

    private static final class ExportWait {
        final CountDownLatch latch = new CountDownLatch(1);
        volatile boolean failed = false;
    }

    private static final class Cancelled extends IOException {
        Cancelled() {
            super("Ses dosyası oluşturma iptal edildi.");
        }
    }

    private static final class UnsupportedApi extends IOException {
        UnsupportedApi() {
            super("Bu özellik Android 10 ve üzerinde kullanılabilir.");
        }
    }

    private static final class AudioMeta {
        String signature;
        long durationMs;
    }

    // ------------------------------------------------------------------ yaşam döngüsü

    @Override
    public void load() {
        instance = this;
        tts = new TextToSpeech(getContext().getApplicationContext(), this::onTtsInit);
        main.postDelayed(this::onInitTimeout, INIT_TIMEOUT_MS);
    }

    @Override
    protected void handleOnDestroy() {
        cancelExport = true;
        pauseInternal(false);
        exec.shutdownNow();
        if (tts != null) {
            try {
                tts.shutdown();
            } catch (Exception ignored) {
            }
            tts = null;
        }
        ready = false;
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    /** Bildirimdeki "Duraklat" düğmesi ve görev kaldırma için. */
    static void pauseFromNotification() {
        NativeTTSPlugin p = instance;
        if (p != null) p.pauseInternal(true);
    }

    private void onTtsInit(int status) {
        boolean ok = status == TextToSpeech.SUCCESS && tts != null;
        if (ok) {
            try {
                tts.setOnUtteranceProgressListener(new Progress());
                turkishResult = tts.isLanguageAvailable(TR);
                if (turkishResult >= TextToSpeech.LANG_AVAILABLE) tts.setLanguage(TR);
            } catch (Exception e) {
                Log.w(TAG, "TTS başlatma ayarları uygulanamadı: " + e.getMessage());
            }
        }
        synchronized (lock) {
            ready = ok;
            initFinished = true;
        }
        resolvePendingStatus();
    }

    private void onInitTimeout() {
        synchronized (lock) {
            if (initFinished) return;
            timedOut = true;
        }
        resolvePendingStatus();
    }

    private void resolvePendingStatus() {
        List<PluginCall> calls;
        synchronized (lock) {
            calls = new ArrayList<>(pendingStatus);
            pendingStatus.clear();
        }
        for (PluginCall c : calls) c.resolve(statusObject());
    }

    // ------------------------------------------------------------------ durum / ses listesi

    @PluginMethod
    public void getStatus(PluginCall call) {
        synchronized (lock) {
            // Motor hazır olmadan sorulursa "Türkçe ses yok" demek yerine hazır olana kadar bekletilir.
            if (!initFinished && !timedOut) {
                pendingStatus.add(call);
                return;
            }
        }
        call.resolve(statusObject());
    }

    private JSObject statusObject() {
        JSObject ret = new JSObject();
        ret.put("native", true);
        ret.put("ready", ready);
        String engine = "";
        String turkish = "unknown";
        JSArray voices = new JSArray();
        if (ready && tts != null) {
            try {
                String e = tts.getDefaultEngine();
                engine = e == null ? "" : e;
                turkishResult = tts.isLanguageAvailable(TR);
                if (turkishResult >= TextToSpeech.LANG_AVAILABLE) turkish = "available";
                else if (turkishResult == TextToSpeech.LANG_MISSING_DATA) turkish = "missing_data";
                else turkish = "not_supported";
                Set<Voice> all = tts.getVoices();
                if (all != null) {
                    for (Voice v : all) {
                        Locale l = v.getLocale();
                        if (l == null || !"tr".equals(l.getLanguage())) continue; // yalnızca Türkçe sesler
                        // İndirilmemiş sesler seçilirse motor indirmeyi tetikler ve speak() öngörülemez davranır.
                        Set<String> features = v.getFeatures();
                        if (features != null && features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                        JSObject o = new JSObject();
                        o.put("name", v.getName());
                        o.put("language", l.toLanguageTag());
                        o.put("quality", v.getQuality());
                        o.put("networkRequired", v.isNetworkConnectionRequired());
                        o.put("genderHint", genderHint(v));
                        voices.put(o);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Ses listesi okunamadı: " + e.getMessage());
            }
        }
        ret.put("engine", engine);
        ret.put("turkish", turkish);
        ret.put("voices", voices);
        if (!ready) ret.put("reason", timedOut ? "timeout" : "no_engine");
        return ret;
    }

    /** Android ses cinsiyeti bilgisi vermez; yalnızca ad/özellikte açıkça yazıyorsa ipucu verilir. */
    private static String genderHint(Voice v) {
        String text = (v.getName() + " " + v.getFeatures()).toLowerCase(Locale.ROOT);
        if (text.contains("female") || text.contains("kadın") || text.contains("woman")) return "female";
        if (text.contains("male") || text.contains("erkek")) return "male";
        return "unknown";
    }

    @PluginMethod
    public void openVoiceSettings(PluginCall call) {
        Context ctx = getContext();
        Intent[] options = new Intent[] {
            new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA),
            new Intent("com.android.settings.TTS_SETTINGS")
        };
        for (Intent intent : options) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                call.resolve();
                return;
            } catch (Exception ignored) {
                // sıradaki seçeneği dene
            }
        }
        call.reject("Ses ayarları açılamadı. Android Ayarlar → Metin okuma çıkışı bölümüne git.");
    }

    // ------------------------------------------------------------------ oynatma kuyruğu

    private final class Progress extends UtteranceProgressListener {
        @Override
        public void onStart(String id) {
            int[] p = parsePlayback(id);
            if (p == null) return;
            synchronized (lock) {
                if (p[0] != session || !playing) return;
                currentIndex = p[1];
            }
            JSObject d = new JSObject();
            d.put("index", p[1]);
            notifyListeners("chunkStart", d);
            enqueueMore();
        }

        @Override
        public void onDone(String id) {
            ExportWait w = id == null ? null : exportWaits.get(id);
            if (w != null) {
                w.latch.countDown();
                return;
            }
            int[] p = parsePlayback(id);
            if (p == null) return;
            boolean last;
            synchronized (lock) {
                if (p[0] != session || !playing) return;
                last = p[1] >= queue.size() - 1;
                if (last) {
                    playing = false;
                    session++;
                }
            }
            if (last) {
                PlaybackService.stop(getContext());
                notifyListeners("queueDone", new JSObject());
            }
        }

        @Override
        public void onError(String id) {
            onError(id, -1);
        }

        @Override
        public void onError(String id, int errorCode) {
            ExportWait w = id == null ? null : exportWaits.get(id);
            if (w != null) {
                w.failed = true;
                w.latch.countDown();
                return;
            }
            int[] p = parsePlayback(id);
            if (p == null) return;
            synchronized (lock) {
                if (p[0] != session || !playing) return;
            }
            failPlayback("Android seslendirme işlemi başarısız oldu (kod " + errorCode + ").");
        }

        @Override
        public void onStop(String id, boolean interrupted) {
            ExportWait w = id == null ? null : exportWaits.get(id);
            if (w != null) {
                w.failed = true;
                w.latch.countDown();
            }
        }
    }

    /** "q-<oturum>-<indeks>" biçimindeki kimliği çözer; başka kimlikler için null döner. */
    private static int[] parsePlayback(String id) {
        if (id == null || !id.startsWith("q-")) return null;
        String[] parts = id.split("-");
        if (parts.length != 3) return null;
        try {
            return new int[] { Integer.parseInt(parts[1]), Integer.parseInt(parts[2]) };
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Kuyrukta her zaman en fazla MAX_AHEAD parça hazır tutulur. */
    private void enqueueMore() {
        boolean failed = false;
        synchronized (lock) {
            while (playing && tts != null && nextToEnqueue < queue.size() && (nextToEnqueue - currentIndex) < MAX_AHEAD) {
                String id = "q-" + session + "-" + nextToEnqueue;
                int r = tts.speak(queue.get(nextToEnqueue), TextToSpeech.QUEUE_ADD, new Bundle(), id);
                if (r == TextToSpeech.ERROR) {
                    failed = true;
                    break;
                }
                nextToEnqueue++;
            }
        }
        if (failed) failPlayback("Android seslendirme başlatılamadı.");
    }

    private void failPlayback(String message) {
        synchronized (lock) {
            playing = false;
            session++;
        }
        try {
            if (tts != null) tts.stop();
        } catch (Exception ignored) {
        }
        PlaybackService.stop(getContext());
        JSObject d = new JSObject();
        d.put("message", message);
        notifyListeners("queueError", d);
    }

    @PluginMethod
    public void speakQueue(PluginCall call) {
        if (!ready || tts == null) {
            call.reject("Android metin okuma motoru hazır değil. Android Ayarlar → Metin okuma çıkışı bölümünden bir motoru etkinleştir.");
            return;
        }
        if (exporting.get()) {
            call.reject("Ses dosyası hazırlanırken seslendirme başlatılamaz. İşlem bitince tekrar dene.");
            return;
        }
        List<String> list = readChunks(call);
        if (list.isEmpty()) {
            call.reject("Seslendirilecek metin boş.");
            return;
        }
        Integer startBoxed = call.getInt("startIndex", 0);
        int start = Math.max(0, Math.min(startBoxed == null ? 0 : startBoxed, list.size() - 1));
        float rate = floatOf(call.getDouble("rate", 1.0), 1f);
        float pitch = floatOf(call.getDouble("pitch", 1.0), 1f);
        String voiceName = call.getString("voiceName", "");
        String title = call.getString("title", "Kitap");

        synchronized (lock) {
            session++;
            queue = list;
            currentIndex = start;
            nextToEnqueue = start;
            playing = true;
        }
        try {
            tts.stop(); // önceki kuyruğu temizle
            applyVoice(voiceName, rate, pitch);
        } catch (Exception e) {
            failPlayback("Ses motoru ayarlanamadı: " + e.getMessage());
            call.reject("Ses motoru ayarlanamadı.");
            return;
        }
        maybeAskNotificationPermission();
        PlaybackService.start(getContext(), title == null ? "Kitap" : title);
        enqueueMore();

        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        boolean was;
        int index;
        synchronized (lock) {
            was = playing;
            index = currentIndex;
        }
        pauseInternal(false);
        JSObject ret = new JSObject();
        ret.put("index", index);
        ret.put("wasPlaying", was);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        JSObject ret = new JSObject();
        synchronized (lock) {
            ret.put("playing", playing);
            ret.put("index", currentIndex);
            ret.put("total", queue.size());
        }
        call.resolve(ret);
    }

    private void pauseInternal(boolean notify) {
        boolean was;
        int index;
        synchronized (lock) {
            was = playing;
            index = currentIndex;
            playing = false;
            session++; // geç gelen geri çağrımlar yok sayılır
        }
        try {
            if (tts != null) tts.stop();
        } catch (Exception ignored) {
        }
        PlaybackService.stop(getContext());
        if (notify && was) {
            JSObject d = new JSObject();
            d.put("index", index);
            notifyListeners("playbackPaused", d);
        }
    }

    private void applyVoice(String voiceName, float rate, float pitch) {
        boolean voiceSet = false;
        if (voiceName != null && !voiceName.isEmpty()) {
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (voiceName.equals(v.getName())) {
                            voiceSet = tts.setVoice(v) == TextToSpeech.SUCCESS;
                            break;
                        }
                    }
                }
            } catch (Exception ignored) {
                // ses seçilemezse dil ayarına düşülür
            }
        }
        if (!voiceSet) tts.setLanguage(TR);
        tts.setSpeechRate(clamp(rate));
        tts.setPitch(clamp(pitch));
    }

    private void maybeAskNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        Context ctx = getContext();
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences prefs = ctx.getSharedPreferences("kitap_seslendir", Context.MODE_PRIVATE);
        if (prefs.getBoolean("asked_notifications", false)) return;
        prefs.edit().putBoolean("asked_notifications", true).apply();
        final Activity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() ->
            ActivityCompat.requestPermissions(activity, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4202));
    }

    // ------------------------------------------------------------------ ses dosyası (M4A) dışa aktarma

    @PluginMethod
    public void exportAudio(PluginCall call) {
        if (!ready || tts == null) {
            call.reject("Android metin okuma motoru hazır değil.");
            return;
        }
        final String bookId = safeId(call.getString("bookId", ""));
        if (bookId.isEmpty()) {
            call.reject("Geçersiz kitap kimliği.");
            return;
        }
        final String signature = call.getString("signature", "");
        final List<String> texts = readChunks(call);
        if (texts.isEmpty()) {
            call.reject("Dışa aktarılacak metin bulunamadı.");
            return;
        }
        final float rate = floatOf(call.getDouble("rate", 1.0), 1f);
        final float pitch = floatOf(call.getDouble("pitch", 1.0), 1f);
        final String voiceName = call.getString("voiceName", "");
        if (!exporting.compareAndSet(false, true)) {
            call.reject("Başka bir ses dosyası hazırlanıyor. Bitmesini bekle.");
            return;
        }
        pauseInternal(true); // aynı TTS örneğini kullandığımız için seslendirme durdurulur
        cancelExport = false;
        try {
            exec.execute(() -> runExport(call, bookId, signature == null ? "" : signature, texts, voiceName, rate, pitch));
        } catch (RuntimeException e) {
            exporting.set(false);
            call.reject("Ses dosyası işlemi başlatılamadı.");
        }
    }

    private void runExport(PluginCall call, String bookId, String signature, List<String> texts,
                           String voiceName, float rate, float pitch) {
        File dir = audioDir();
        File out = audioFile(bookId);
        File part = new File(dir, bookId + ".m4a.part");
        File wav = new File(dir, bookId + "-tmp.wav");
        AacEncoder enc = null;
        boolean ok = false;
        try {
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("Geçici ses klasörü oluşturulamadı.");

            // Aynı metin/ses/hız için dosya zaten varsa yeniden üretilmez (önbellek).
            AudioMeta cached = readMeta(bookId);
            if (out.exists() && cached != null && signature.equals(cached.signature)) {
                resolveAudio(call, out, cached.durationMs);
                ok = true;
                return;
            }

            long chars = 0;
            for (String t : texts) chars += t.length();
            long needed = chars * 600L + 24L * 1024 * 1024; // ~64 kbps AAC + geçici WAV payı
            if (dir.getUsableSpace() < needed) {
                throw new IOException("Cihazda yeterli boş alan yok. Ses dosyası için yaklaşık "
                        + (needed / 1024 / 1024) + " MB gerekli.");
            }

            // Yarım kalmış önceki denemeleri temizle; çıktı önce .part'a yazılır, bitince atomik yeniden adlandırılır.
            deleteQuietly(part);
            deleteQuietly(out);
            deleteQuietly(sigFile(bookId));

            applyVoice(voiceName, rate, pitch);

            int total = texts.size();
            int sampleRate = 0;
            int channels = 0;
            for (int i = 0; i < total; i++) {
                if (cancelExport) throw new Cancelled();
                String text = texts.get(i);
                if (text.trim().isEmpty()) continue;

                synthesize(text, wav, i);
                WavReader.Info wi = WavReader.parse(wav);
                if (enc == null) {
                    sampleRate = wi.sampleRate;
                    channels = wi.channels;
                    enc = new AacEncoder(part, sampleRate, channels);
                } else if (wi.sampleRate != sampleRate || wi.channels != channels) {
                    throw new IOException("Ses motoru parçalar arasında örnekleme hızını değiştirdi.");
                }

                try (RandomAccessFile raf = new RandomAccessFile(wav, "r")) {
                    raf.seek(wi.dataOffset);
                    long remaining = wi.dataLength;
                    byte[] buf = new byte[16384];
                    while (remaining > 0) {
                        if (cancelExport) throw new Cancelled();
                        int n = (int) Math.min(buf.length, remaining);
                        raf.readFully(buf, 0, n);
                        enc.write(buf, 0, n);
                        remaining -= n;
                    }
                }
                if (i < total - 1) enc.writeSilence(300);
                deleteQuietly(wav);

                JSObject progress = new JSObject();
                progress.put("done", i + 1);
                progress.put("total", total);
                notifyListeners("exportProgress", progress);
            }
            if (enc == null) throw new IOException("Seslendirilecek metin bulunamadı.");

            enc.finish();
            long durationMs = enc.durationMs();
            enc.release();
            enc = null;
            if (!part.renameTo(out)) throw new IOException("Ses dosyası kaydedilemedi.");
            writeMeta(bookId, signature, durationMs);
            ok = true;
            resolveAudio(call, out, durationMs);
        } catch (Cancelled c) {
            call.reject("Ses dosyası oluşturma iptal edildi.", "CANCELLED");
        } catch (Exception e) {
            Log.w(TAG, "Ses dosyası oluşturulamadı", e);
            String m = e.getMessage();
            call.reject(m == null || m.isEmpty() ? "Ses dosyası oluşturulamadı." : m);
        } finally {
            if (enc != null) enc.release();
            deleteQuietly(wav);
            if (!ok) deleteQuietly(part);
            exporting.set(false);
        }
    }

    private void synthesize(String text, File wav, int index) throws IOException, InterruptedException {
        deleteQuietly(wav);
        String id = "e-" + System.nanoTime() + "-" + index;
        ExportWait wait = new ExportWait();
        exportWaits.put(id, wait);
        try {
            int r = tts.synthesizeToFile(text, new Bundle(), wav, id);
            if (r == TextToSpeech.ERROR) throw new IOException("Ses motoru metin parçasını kabul etmedi.");
            long deadline = System.currentTimeMillis() + SYNTH_TIMEOUT_MS;
            while (!wait.latch.await(500, TimeUnit.MILLISECONDS)) {
                if (cancelExport) {
                    tts.stop();
                    throw new Cancelled();
                }
                if (System.currentTimeMillis() > deadline) {
                    tts.stop();
                    throw new IOException("Ses üretimi zaman aşımına uğradı.");
                }
            }
            if (wait.failed) {
                if (cancelExport) throw new Cancelled();
                throw new IOException("Metin parçası " + (index + 1) + " ses dosyasına dönüştürülemedi.");
            }
            if (!wav.exists() || wav.length() <= 44) throw new IOException("Ses motoru boş dosya üretti.");
        } finally {
            exportWaits.remove(id);
        }
    }

    @PluginMethod
    public void cancelExport(PluginCall call) {
        cancelExport = true;
        call.resolve();
    }

    private void resolveAudio(PluginCall call, File file, long durationMs) {
        JSObject ret = new JSObject();
        ret.put("uri", Uri.fromFile(file).toString());
        ret.put("fileName", file.getName());
        ret.put("bytes", file.length());
        ret.put("durationMs", durationMs);
        call.resolve(ret);
    }

    @PluginMethod
    public void getAudioInfo(PluginCall call) {
        String bookId = safeId(call.getString("bookId", ""));
        String signature = call.getString("signature", "");
        File file = audioFile(bookId);
        JSObject ret = new JSObject();
        boolean exists = !bookId.isEmpty() && file.exists() && file.length() > 0;
        ret.put("exists", exists);
        ret.put("matches", false);
        if (exists) {
            AudioMeta meta = readMeta(bookId);
            ret.put("matches", meta != null && meta.signature != null && meta.signature.equals(signature));
            ret.put("bytes", file.length());
            ret.put("uri", Uri.fromFile(file).toString());
            ret.put("fileName", file.getName());
            ret.put("durationMs", meta == null ? 0 : meta.durationMs);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteAudio(PluginCall call) {
        String bookId = safeId(call.getString("bookId", ""));
        if (!bookId.isEmpty()) {
            File dir = audioDir();
            deleteQuietly(audioFile(bookId));
            deleteQuietly(sigFile(bookId));
            deleteQuietly(new File(dir, bookId + ".m4a.part"));
            deleteQuietly(new File(dir, bookId + "-tmp.wav"));
        }
        call.resolve();
    }

    // ------------------------------------------------------------------ kaydet / paylaş (MediaStore)

    @PluginMethod
    public void saveAudio(PluginCall call) {
        try {
            Uri uri = saveToMediaStore(safeId(call.getString("bookId", "")), call.getString("title", "kitap"));
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("folder", "Müzik/Kitap Seslendir");
            call.resolve(ret);
        } catch (UnsupportedApi e) {
            call.reject(e.getMessage(), "UNSUPPORTED_API");
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Ses dosyası kaydedilemedi." : e.getMessage());
        }
    }

    @PluginMethod
    public void shareAudio(PluginCall call) {
        try {
            Uri uri = saveToMediaStore(safeId(call.getString("bookId", "")), call.getString("title", "kitap"));
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("audio/mp4");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Ses dosyasını paylaş");
            Activity activity = getActivity();
            if (activity == null) throw new IOException("Paylaşım penceresi açılamadı.");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(chooser);
            call.resolve();
        } catch (UnsupportedApi e) {
            call.reject(e.getMessage(), "UNSUPPORTED_API");
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Paylaşım açılamadı." : e.getMessage());
        }
    }

    /** Önbellekteki .m4a dosyasını Müzik/Kitap Seslendir klasörüne kopyalar (Android 10+). */
    private Uri saveToMediaStore(String bookId, String title) throws IOException {
        if (Build.VERSION.SDK_INT < 29) throw new UnsupportedApi();
        File src = audioFile(bookId);
        if (bookId.isEmpty() || !src.exists() || src.length() == 0) {
            throw new IOException("Ses dosyası bulunamadı. Önce ses dosyasını oluştur.");
        }
        if (Environment.getExternalStorageDirectory().getUsableSpace() < src.length() + 8L * 1024 * 1024) {
            throw new IOException("Cihazda yeterli boş alan yok. Yer açıp tekrar dene.");
        }
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Audio.Media.DISPLAY_NAME, safeName(title) + ".m4a");
        values.put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4");
        values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Kitap Seslendir");
        values.put(MediaStore.Audio.Media.IS_PENDING, 1);
        Uri collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri uri = resolver.insert(collection, values);
        if (uri == null) throw new IOException("Müzik klasöründe dosya oluşturulamadı.");
        try (InputStream in = new FileInputStream(src); OutputStream outStream = resolver.openOutputStream(uri)) {
            if (outStream == null) throw new IOException("Müzik klasörüne yazılamadı.");
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) outStream.write(buf, 0, n);
        } catch (IOException | RuntimeException e) {
            try {
                resolver.delete(uri, null, null); // yarım kalan kaydı bırakma
            } catch (Exception ignored) {
            }
            throw e;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Audio.Media.IS_PENDING, 0);
        resolver.update(uri, done, null, null);
        return uri;
    }

    // ------------------------------------------------------------------ yardımcılar

    private File audioDir() {
        return new File(getContext().getCacheDir(), "book-audio");
    }

    private File audioFile(String bookId) {
        return new File(audioDir(), bookId + ".m4a");
    }

    private File sigFile(String bookId) {
        return new File(audioDir(), bookId + ".sig");
    }

    private AudioMeta readMeta(String bookId) {
        File f = sigFile(bookId);
        if (!f.exists()) return null;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
            AudioMeta m = new AudioMeta();
            m.signature = r.readLine();
            String d = r.readLine();
            m.durationMs = d == null ? 0 : Long.parseLong(d.trim());
            return m;
        } catch (Exception e) {
            return null;
        }
    }

    private void writeMeta(String bookId, String signature, long durationMs) throws IOException {
        try (OutputStream o = new FileOutputStream(sigFile(bookId))) {
            o.write((signature + "\n" + durationMs + "\n").getBytes(StandardCharsets.UTF_8));
        }
    }

    private static void deleteQuietly(File f) {
        try {
            if (f.exists() && !f.delete()) Log.w(TAG, "Silinemedi: " + f.getName());
        } catch (Exception ignored) {
        }
    }

    private static List<String> readChunks(PluginCall call) {
        List<String> list = new ArrayList<>();
        JSArray arr = call.getArray("chunks");
        if (arr == null) return list;
        for (int i = 0; i < arr.length(); i++) {
            String s = arr.optString(i, "");
            list.add(s.trim().isEmpty() ? "." : s); // boş parça kuyruğu bozmasın
        }
        return list;
    }

    /** Dosya yolu çıkışını (path traversal) engellemek için kimlik güvenli karakterlere indirgenir. */
    private static String safeId(String id) {
        String s = id == null ? "" : id.replaceAll("[^A-Za-z0-9_-]", "_");
        return s.length() > 80 ? s.substring(0, 80) : s;
    }

    private static String safeName(String title) {
        String s = title == null ? "" : title.replaceAll("[^\\p{L}\\p{N} _-]", "_").trim();
        if (s.length() > 60) s = s.substring(0, 60).trim();
        return s.isEmpty() ? "kitap" : s;
    }

    private static float floatOf(Double value, float fallback) {
        return value == null ? fallback : value.floatValue();
    }

    private static float clamp(float v) {
        return Math.max(0.5f, Math.min(2.0f, v));
    }
}
