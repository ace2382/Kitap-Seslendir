# Değişiklikler (v3.3 → v3.4)

Yeni özellikler: **ses seviyesi**, **paragraf/başlık arası duraklama**, **telaffuz sözlüğü**.

## Kullanıcıya görünenler
- **Ses seviyesi** (%10–%100, varsayılan %100): oynatmada her konuşmaya `KEY_PARAM_VOLUME` olarak iletilir. Telefonun medya sesine göre ölçeklenir, onu aşamaz. Ses dosyasında `synthesizeToFile` seviyeyi uygulamadığı için aynı oran PCM örneklerine kazanç olarak işlenir (taşma kırpılır).
- **Duraklamalar**: paragraflar arası (0–2 sn, varsayılan 0,4) ve başlığın öncesi + sonrası (0–3 sn, varsayılan 0,8). Oynatmada `playSilentUtterance`, ses dosyasında PCM sessizliği kullanılır. 0 seçilirse eski davranış (paragraflar tek metin olarak okunur, ek sessizlik yok).
  - Paragrafın ortasına düşen parça sınırında duraklama konmaz.
  - Sayfa sonunda yarım kalan cümle sonraki sayfada küçük harfle sürüyorsa duraklama konmaz.
  - Eski sürümde ses dosyasında her parça sonuna sabit 300 ms konuyordu; artık yalnızca paragraf/başlık sınırlarında, ayarlanan süre kadar bekleme var.
- **Telaffuz sözlüğü**: "yazılışı → okunuşu" kuralları (ör. `TBMM → te be em em`, `Dr. → doktor`). Kural başına "tam kelime" ve "harf duyarlı" seçenekleri, düzenleme, silme ve kuralın okunuşunu **Dinle** düğmesi. Sözlük tüm kitaplar için ortaktır, cihazda (localStorage) saklanır. Yalnızca seslendirilecek metne uygulanır; ekrandaki metin değişmez.
  - Türkçe harf kuralları doğru işler (`I↔ı`, `İ↔i`); `\b` yalnızca ASCII olduğu için tam kelime denetimi Unicode'a duyarlı yazıldı. `NASA'nın` gibi kesme işaretli ekler eşleşir.
  - Tek geçişte uygulanır: bir kuralın çıktısı başka kural tarafından yeniden değiştirilmez; aynı konumda uzun anahtar kısa olana üstündür.
- Ses dosyası önbellek imzası artık seviye, duraklamalar ve sözlük etkisini de içerir. **Önceki sürümle oluşturulmuş ses dosyaları "eskidi" görünür**, yeniden oluşturulmalıdır.

## Teknik
- `src/lib/text.ts`: parça (`Chunk`) artık `segments` taşır (paragraf metni, başlık mı, paragraf başı mı). Parça metni ve sınırları **değişmedi** (rastgele 400 girdide eski/yeni parçalama birebir karşılaştırıldı); böylece kayıtlı ilerleme ve parça sayıları geçerli kalır.
- `src/lib/speech.ts` (yeni, saf mantık): duraklama planı, sözlük derleme/uygulama, sözlüğü okuma/doğrulama/güncelleme.
- Köprü: `chunks: string[]` yerine `plan: { text, pauseAfterMs }[][]` ve `volume`. Web yedeği (tarayıcı) de aynı planı kullanır.
- `NativeTTSPlugin.java`: kuyruk parça → segment → sessizlik olarak ilerler. Kimlik biçimi `q-<oturum>-<parça>-<sıra>`; `chunkStart` yalnızca parçanın ilk konuşmasında, `queueDone` yalnızca kuyruğun son konuşması bitince bir kez gelir. Kitabın son segmentinden sonra sessizlik eklenmez.
- Yeni testler: `src/lib/speech.test.ts` ve `text.test.ts` içinde segment testleri (toplam 89 test). `tools/jvm-test/`: Java kuyruğunu ve dışa aktarmayı sahte TTS motoruyla JVM'de deneyen bir araç (`bash tools/jvm-test/run.sh`, JDK 17+).
- Sürüm 1.2.0.

## Bilinen sınırlar
- Java değişikliği Android SDK'sı olmadan, **Android API'lerinin sahte karşılıklarına** karşı derlenip denendi (`tools/jvm-test/`). Gerçek `TextToSpeech` motoru ve cihaz davranışı denenmedi; `docs/TEST-PLAN.md` B bölümündeki yeni maddelerle cihazda doğrulanmalı.
- Ses seviyesi medya sesini aşamaz; daha yüksek ses için telefonun ses tuşu kullanılır.
- Duraklama süresi, motorun cümle sonlarındaki doğal beklemesinin **üstüne** eklenir; motorlar arası fark olabilir.
- Sözlük harf eşleştirmesi yapar, okunuş (fonem) üretmez: doğru okunuş için kelimeyi Türkçe okunacağı gibi yazmak gerekir (ör. `Kafka → kafka`, `wifi → vayfay`).
- Sözlük kuralları yalnızca tek bir paragraf/cümle içinde eşleşir; cümle sonu noktasıyla ayrılan ifadeler (ör. `Dr. Ahmet`) parça sınırına denk gelirse eşleşmeyebilir.

---

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
