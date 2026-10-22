package com.kitapseslendir.app;

import android.content.Context;
import android.speech.tts.TextToSpeech;
import com.getcapacitor.*;
import java.io.File;
import java.lang.reflect.Method;
import java.util.*;
import java.util.function.BooleanSupplier;

public class QueueTest {
    static int failures = 0;
    static void check(boolean ok, String msg) { System.out.println((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failures++; }
    static void waitFor(BooleanSupplier c, long ms) throws Exception { long end = System.currentTimeMillis() + ms; while (!c.getAsBoolean() && System.currentTimeMillis() < end) Thread.sleep(5); }
    static long count(List<String> l, String s) { synchronized (l) { return l.stream().filter(x -> x.equals(s)).count(); } }
    static List<String> snapshot(List<String> l) { synchronized (l) { return new ArrayList<>(l); } }

    /** "metin|bekleme" biçimindeki segmentlerden bir parça üretir. */
    static JSArray chunk(String... segs) {
        JSArray c = new JSArray();
        for (String s : segs) {
            String[] p = s.split("\\|");
            JSObject o = new JSObject();
            o.put("text", p[0]);
            o.put("pauseAfterMs", Integer.parseInt(p[1]));
            c.put(o);
        }
        return c;
    }
    static JSArray plan(JSArray... chunks) { JSArray a = new JSArray(); for (JSArray c : chunks) a.put(c); return a; }

    static NativeTTSPlugin newPlugin(File cache) throws Exception {
        Context ctx = new Context(); ctx.cache = cache; Plugin.ctx = ctx;
        NativeTTSPlugin p = new NativeTTSPlugin();
        p.load();
        PluginCall st = new PluginCall();
        p.getStatus(st);
        st.done.await();
        return p;
    }

    public static void main(String[] args) throws Exception {
        File cache = java.nio.file.Files.createTempDirectory("ks").toFile();
        NativeTTSPlugin p = newPlugin(cache);

        // ------------------------------------------------------------ 1) tam oynatma
        System.out.println("1) Oynatma: paragraf segmentleri + sessizlikler + ses seviyesi");
        Plugin.clearEvents(); TextToSpeech.log.clear();
        PluginCall c1 = new PluginCall();
        c1.data.put("plan", plan(
            chunk("Başlık|800", "Birinci paragraf.|400"),
            chunk("İkinci parça tek paragraf.|400"),
            chunk("Son paragraf.|999")));   // kitabın sonu: bekleme çalınmamalı
        c1.data.put("startIndex", 0); c1.data.put("rate", 1.0); c1.data.put("pitch", 1.0); c1.data.put("volume", 0.5);
        c1.data.put("voiceName", "tr-voice"); c1.data.put("title", "Deneme");
        p.speakQueue(c1);
        waitFor(() -> count(Plugin.events, "queueDone") > 0, 5000);
        Thread.sleep(150);
        List<String> ev = snapshot(Plugin.events);
        System.out.println("     olaylar: " + ev);
        check(ev.equals(Arrays.asList("chunkStart:0", "chunkStart:1", "chunkStart:2", "queueDone")), "chunkStart 0,1,2 birer kez; queueDone tam bir kez ve en sonda");
        List<String> log = snapshot(TextToSpeech.log);
        List<String> started = new ArrayList<>();
        for (String s : log) if (s.startsWith("start:")) started.add(s.replaceAll("^start:q-\\d+-", ""));
        System.out.println("     çalma sırası: " + started);
        check(started.equals(Arrays.asList("0-0:vol0.5", "0-1:silence800", "0-2:vol0.5", "0-3:silence400", "1-0:vol0.5", "1-1:silence400", "2-0:vol0.5")),
              "sıra: başlık → 800ms sessizlik → paragraf → 400ms → sonraki parça…; son paragraftan sonra sessizlik YOK; seviye 0.5 iletildi");
        check(log.stream().noneMatch(s -> s.startsWith("silent:") && s.endsWith(":999")), "kitabın son segmentinin beklemesi kuyruğa eklenmedi");
        PluginCall s1 = new PluginCall(); p.getPlaybackState(s1);
        check(Boolean.FALSE.equals(s1.resolved.opt("playing")), "bitince playing=false");

        // ------------------------------------------------------------ 2) durdurma
        System.out.println("2) Oynatma ortasında durdurma");
        Plugin.clearEvents(); TextToSpeech.log.clear(); TextToSpeech.speechMsPerChar = 20;
        PluginCall c2 = new PluginCall();
        c2.data.put("plan", plan(chunk("Bir iki üç dört beş altı|600", "yedi sekiz|600"), chunk("dokuz on|0"), chunk("on bir|0")));
        c2.data.put("volume", 1.0);
        p.speakQueue(c2);
        waitFor(() -> count(Plugin.events, "chunkStart:0") > 0, 2000);
        Thread.sleep(60);
        PluginCall stop = new PluginCall(); p.stop(stop);
        check(Boolean.TRUE.equals(stop.resolved.opt("wasPlaying")) && ((Number) stop.resolved.opt("index")).intValue() == 0, "stop(): wasPlaying=true, index=0");
        Thread.sleep(800);
        ev = snapshot(Plugin.events);
        check(!ev.contains("queueDone") && !ev.contains("chunkStart:1"), "durdurulduktan sonra yeni parça başlamadı, queueDone gelmedi: " + ev);
        TextToSpeech.speechMsPerChar = 2;

        // ------------------------------------------------------------ 3) ileri sarma (startIndex)
        System.out.println("3) startIndex ile başlatma");
        Plugin.clearEvents(); TextToSpeech.log.clear();
        PluginCall c3 = new PluginCall();
        c3.data.put("plan", plan(chunk("a|0"), chunk("b|300"), chunk("c|0")));
        c3.data.put("startIndex", 1);
        p.speakQueue(c3);
        waitFor(() -> count(Plugin.events, "queueDone") > 0, 3000);
        ev = snapshot(Plugin.events);
        check(ev.equals(Arrays.asList("chunkStart:1", "chunkStart:2", "queueDone")), "1. parçadan başladı: " + ev);

        // ------------------------------------------------------------ 4) tek segmentli, bekleme 0 (eski davranış)
        System.out.println("4) Bekleme 0: sessizlik kuyruğa eklenmez");
        Plugin.clearEvents(); TextToSpeech.log.clear();
        PluginCall c4 = new PluginCall();
        c4.data.put("plan", plan(chunk("x\ny|0"), chunk("z|0")));
        p.speakQueue(c4);
        waitFor(() -> count(Plugin.events, "queueDone") > 0, 3000);
        check(snapshot(TextToSpeech.log).stream().noneMatch(s -> s.startsWith("silent:")), "sessizlik yok");
        check(snapshot(Plugin.events).equals(Arrays.asList("chunkStart:0", "chunkStart:1", "queueDone")), "olaylar doğru");

        // ------------------------------------------------------------ 5) bozuk plan
        System.out.println("5) Bozuk / boş plan girdileri");
        PluginCall c5 = new PluginCall(); p.speakQueue(c5);
        check("Seslendirilecek metin boş.".equals(c5.rejected), "plan yok → anlaşılır hata");
        Plugin.clearEvents(); TextToSpeech.log.clear();
        PluginCall c6 = new PluginCall();
        JSArray bad = new JSArray(); bad.put("yanlış"); bad.put(chunk("  |100")); bad.put(chunk("tamam|0"));
        c6.data.put("plan", bad);
        p.speakQueue(c6);
        waitFor(() -> count(Plugin.events, "queueDone") > 0, 3000);
        List<String> sp = snapshot(TextToSpeech.log); sp.removeIf(s -> !s.startsWith("speak:"));
        System.out.println("     speak: " + sp);
        check(sp.size() == 3 && sp.get(0).endsWith(":.") && sp.get(1).endsWith(":.") && sp.get(2).endsWith(":tamam"), "geçersiz/boş parçalar kuyruğu bozmadan \".\" olarak okundu");

        // ------------------------------------------------------------ 6) ses dosyası dışa aktarma
        System.out.println("6) Dışa aktarma: segment başına sentez, PCM sessizliği, ses kazancı");
        Plugin.clearEvents(); TextToSpeech.log.clear(); AacEncoder.log.clear(); AacEncoder.writes.clear();
        TextToSpeech.sampleValue = 1000;
        PluginCall e1 = new PluginCall();
        e1.data.put("bookId", "kitap1"); e1.data.put("signature", "imza1"); e1.data.put("volume", 0.5);
        e1.data.put("plan", plan(chunk("Başlık|700", "Paragraf bir|300", "Paragraf iki|0"), chunk("Son|5000")));
        p.exportAudio(e1);
        e1.done.await();
        System.out.println("     encoder: " + snapshot(AacEncoder.log));
        System.out.println("     olaylar: " + snapshot(Plugin.events));
        check(e1.rejected == null && e1.resolved != null, "dışa aktarma başarılı" + (e1.rejected != null ? " (hata: " + e1.rejected + ")" : ""));
        List<String> el = snapshot(AacEncoder.log);
        List<String> shape = new ArrayList<>(); for (String s : el) shape.add(s.startsWith("write:") ? "write" : s); 
        check(shape.equals(Arrays.asList("open:22050:1", "write", "silence:700", "write", "silence:300", "write", "write")),
              "sıra: başlık, 700ms sessizlik, paragraf, 300ms sessizlik, paragraf (bekleme 0 → yok), Son (kitap sonu → 5000ms eklenmedi)");
        check(AacEncoder.writes.stream().allMatch(w -> w[0] == 500), "tüm örnekler 1000 × 0.5 = 500");
        check(snapshot(Plugin.events).equals(Arrays.asList("exportProgress:1", "exportProgress:2")), "ilerleme parça bazında: 1/2, 2/2");

        // aynı imza → önbellek (önceki işlemin bayrağını temizlemesi için kısa bekleme; gerçek uygulamada JS gidiş-dönüşü bunu sağlar)
        Thread.sleep(200);
        Plugin.clearEvents(); AacEncoder.log.clear();
        PluginCall e2 = new PluginCall();
        e2.data.put("bookId", "kitap1"); e2.data.put("signature", "imza1"); e2.data.put("plan", plan(chunk("Başlık|700")));
        p.exportAudio(e2); e2.done.await();
        check(e2.rejected == null && AacEncoder.log.isEmpty(), "aynı imza: yeniden üretilmedi (önbellek)");

        // volume=1 → kazanç uygulanmaz
        Thread.sleep(200);
        AacEncoder.writes.clear();
        PluginCall e3 = new PluginCall();
        e3.data.put("bookId", "kitap2"); e3.data.put("signature", "x"); e3.data.put("volume", 1.0); e3.data.put("plan", plan(chunk("Merhaba|0")));
        p.exportAudio(e3); e3.done.await();
        System.out.println("     e3 reddi: " + e3.rejected + " | yazımlar: " + AacEncoder.writes.size());
        check(e3.rejected == null && !AacEncoder.writes.isEmpty() && AacEncoder.writes.stream().allMatch(w -> w[0] == 1000), "seviye 1.0: örnekler değişmedi (1000)");

        // ------------------------------------------------------------ 7) applyGain uç durumları
        System.out.println("7) applyGain: işaret, bayt sırası, kırpma");
        Method g = NativeTTSPlugin.class.getDeclaredMethod("applyGain", byte[].class, int.class, float.class);
        g.setAccessible(true);
        byte[] b = new byte[8];
        short[] in = { 30000, -30000, 1, -1 };
        for (int i = 0; i < 4; i++) { b[2 * i] = (byte) (in[i] & 0xFF); b[2 * i + 1] = (byte) ((in[i] >> 8) & 0xFF); }
        g.invoke(null, b, 8, 2.0f);
        short[] out = new short[4]; for (int i = 0; i < 4; i++) out[i] = (short) ((b[2 * i] & 0xFF) | (b[2 * i + 1] << 8));
        System.out.println("     " + Arrays.toString(out));
        check(out[0] == 32767 && out[1] == -32768 && out[2] == 2 && out[3] == -2, "2× kazanç: +taşma kırpıldı, −taşma kırpıldı, küçük örnekler doğru");
        b = new byte[4]; short[] in2 = { -20000, 20000 };
        for (int i = 0; i < 2; i++) { b[2 * i] = (byte) (in2[i] & 0xFF); b[2 * i + 1] = (byte) ((in2[i] >> 8) & 0xFF); }
        g.invoke(null, b, 4, 0.1f);
        short a0 = (short) ((b[0] & 0xFF) | (b[1] << 8)), a1 = (short) ((b[2] & 0xFF) | (b[3] << 8));
        check(a0 == -2000 && a1 == 2000, "0.1× kazanç: " + a0 + ", " + a1);

        System.out.println(failures == 0 ? "\nTÜM JAVA KONTROLLERİ GEÇTİ" : "\n" + failures + " KONTROL BAŞARISIZ");
        System.exit(failures == 0 ? 0 : 1);
    }
}
