# Değişiklikler (v3.2 → v3.3)

- `.github/workflows/build-apk.yml`: `package-lock` artifact'ini yükleyen adımın koşulu `hashFiles('package-lock.json') == ''` idi. Koşul `npm install`'dan sonra değerlendirildiği için (dosya o sırada oluşur) hiçbir zaman doğru olmuyor ve kilit dosyası yüklenmiyordu. Kilidin repoda olup olmadığı artık `npm`'den önce bir adımda (`steps.lock.outputs.present`) kaydediliyor; yoksa özet sayfasına yönerge de yazılıyor.
- Sürüm 1.1.3. Başka dosyaya dokunulmadı.

---

# Değişiklikler (v3.1 → v3.2)

- `vitest.config.ts` eklendi, `vite.config.ts` yalnızca `vite`'ten `defineConfig` kullanıyor. Vitest 2.1.x kendi içinde Vite 5 getirir (Vite 6 desteği 2.1.7'de geri alındı); proje Vite 6 olduğu için `tsc -b` adımında `vite.config.ts` içinde iki farklı `Plugin` tipi çakışabilirdi.
- `NativeTTSPlugin.java`: `notInstalled` özelliği taşıyan (henüz indirilmemiş) Türkçe sesler artık listelenmiyor. Seçilirse motor indirmeyi tetikler ve `speak()` öngörülemez davranırdı. Hiç kurulu Türkçe ses yoksa arayüz zaten "Türkçe ses verisini yükle" yönlendirmesini gösteriyor.
- Sürüm 1.1.2. Başka dosyaya dokunulmadı.

---

# Değişiklikler (v3 → v3.1)

- `src/pdf.ts`: `task.promise.then(() => page.cleanup())` TypeScript hatası veriyordu (`cleanup()` boolean döndürür, `Promise<void>` bekleniyor) ve `tsc -b` adımında derleme düşüyordu → süslü parantezli gövdeye çevrildi.
- `package.json`: `@capacitor/share` 7.0.2 → 7.0.1 (7.0.1 yayında doğrulandı; 7.0.2 doğrulanamadı). Sürüm 1.1.1.

## Bilinen sınırlar (v3.1'de değişmedi)
- Java tarafı bu sürümde derlenemedi; bu yüzden dokunulmadı. İlk APK'da `docs/TEST-PLAN.md` ile cihazda denenmeli.
- Ses odağı (audio focus) istenmiyor: telefon çağrısı veya başka müzikle seslendirme karışabilir.
- Servis başlatılıp hemen durdurulursa Android'de nadiren `ForegroundServiceDidNotStartInTimeException` görülebilir.

---

# Değişiklikler (v2 → v3)

## Derlemeyi kıran sorunlar
- Workflow `package-lock.json` yokken düşüyordu → artık kilit varsa `npm ci`, yoksa `npm install` + kilidi artifact olarak yükler; sürümler tam sabitlendi.
- FFmpegKit (emekli, GPL) kaldırıldı → Android'in yerleşik `MediaCodec` AAC kodlayıcısı (M4A).
- `(float) call.getDouble(...)` derleme hatası → `Double`/`null` güvenli dönüşüm.
- Manifest'te TTS `<queries>` yoktu → `scripts/manifest-patch.mjs` ekler ve doğrular.
- `src/vite-env.d.ts` yoktu (`?url`/css tipleri) ve JSX'te `<o>` etiketi vardı → `tsc -b` düşüyordu; düzeltildi.

## Çalışma zamanı
- MP3 birleştirme listesindeki sahte `\n` sorunu → FFmpeg birleştirme kalktı; parçalar tek akışta kodlanıyor.
- pdf.js ana derlemesi (`Promise.withResolvers`) → `legacy` derleme; işçi `?worker` ile `.js` olarak paketleniyor.
- Her ilerleme kaydında tüm kitap yeniden yazılıyordu → meta / metin / PDF ayrı kayıtlar; sayfa görselleri istek üzerine çiziliyor.
- "Bu sayfayı dinle" durdurulamıyordu → tek yerel kuyruk; her şey duraklatılabilir.
- `getStatus` motor hazır olmadan "Türkçe ses yok" gösteriyordu → hazır olana kadar bekler, zaman aşımı ayrı bildirilir.
- pdf.js ham İngilizce hata mesajları → Türkçe mesajlar; parolalı PDF için parola penceresi.

## Eksik özellikler
- Bölüm algılama ve "Bölüme git"; paragraf/başlık yapısı.
- Yalnızca Türkçe sesler, "Sesi dene", çevrimdışı sesleri öne alma.
- Ses dosyası önbelleği (imza kontrollü), Müzik klasörüne kaydetme (MediaStore), paylaşma.
- Arka plan/kilit ekranı oynatma (yerel kuyruk + foreground servis + bildirim).
- Geniş satır aralıklı (≈1,8×) metinlerde her satırın ayrı paragraf sayılması düzeltildi (sayfanın normal satır aralığı ölçülüyor).
- Uygulama ikonları, `test-fixtures/`, gerçek birim testleri (≈50), test planı, release belgesi.
