# Test planı

## A) Otomatik testler (`npm test`, Node'da çalışır, cihaz gerekmez)

| Dosya | Kapsam |
|---|---|
| `src/lib/text.test.ts` | normalleştirme (tireli kelime, ligatür), **TTS parçalama** (Türkçe karakter, uzun paragraf, boşluksuz dev kelime, emoji/surrogate, 4000 karakter limiti, 1,5 MB performans, metin kaybı yok), sayfa sınırı, bölüm→parça eşlemesi, süre tahmini |
| `src/lib/pdfText.test.ts` | satır→paragraf, başlık algılama, sayfa numarası ayıklama, girintili paragraf, "Bölüm müdürü…" gibi yanlış pozitifler |
| `src/lib/extract.test.ts` | sayfa sırası, ilerleme, yalnızca görsel PDF (OCR uyarısı), kısmen taranmış, sayfasız, 3000+ sayfa, iptal |
| `src/lib/errors.test.ts` | boş/PDF olmayan/çok büyük dosya, parolalı/bozuk/depolama dolu hata mesajları (ham İngilizce sızmaz) |
| `scripts/manifest-patch.test.mjs` | `<queries>` (TTS_SERVICE), servis ve izinlerin manifest'e eklenmesi, idempotentlik |

Bu ortamda ayrıca (CI'a dahil değil) gerçek pdf.js ile `test-fixtures/` üzerinde uçtan uca çalıştırıldı:
metinli/bölümlü, parolalı (doğru/yanlış/parolasız), yalnızca görsel, boş, bozuk, PDF olmayan.
`WavReader` JVM'de sentetik WAV'larla (44 baytlık başlık, veri uzunluğu 0, fazladan LIST bölümü, 8 bit, düşük hız, kısa dosya) test edildi.

## B) Cihazda elle yapılması gerekenler (otomatikleştirilemedi — Android cihaz/emülatör gerekir)

Her madde için sonucu işaretleyin.

**Kurulum / çevrimdışı**
- [ ] Uçak modunda uygulama açılıyor, PDF seçiliyor, metin çıkıyor.
- [ ] Uçak modunda **çevrimdışı** etiketli Türkçe sesle oynatma çalışıyor.
- [ ] Türkçe ses verisi yokken uyarı + "Türkçe ses verisini yükle" düğmesi ses ayarlarını açıyor; veri yüklenip uygulamaya dönünce liste yenileniyor.
- [ ] TTS motoru hiç yokken (veya devre dışıyken) "motor hazır değil" uyarısı; uygulama çökmüyor.
- [ ] Android 11+ cihazda TTS motoru görünüyor (`<queries>` yaması).

**PDF'ler** (`test-fixtures/` ile)
- [ ] `hikaye-bolumlu.pdf`: 2 bölüm listede, "Bölüme git" doğru yerden başlatıyor.
- [ ] `parolali.pdf`: parola penceresi; yanlış parola → tekrar sorar; "Vazgeç" → hata mesajı, kayıt oluşmaz.
- [ ] `sadece-gorsel.pdf`, `bos.pdf`, `bozuk.pdf`, `pdf-degil.pdf`: anlaşılır Türkçe uyarı.
- [ ] Çok büyük PDF (örn. 300+ sayfa, 50–100 MB): içe aktarma ilerleme gösteriyor, İptal çalışıyor, arayüz donmuyor, bellek hatası yok.
- [ ] 100 MB üzeri dosya reddediliyor.
- [ ] Uzun paragraf, sayfa sonunda biten cümle, Türkçe karakterler (ş ç ğ ı İ ö ü) doğru okunuyor.

**Oynatma**
- [ ] Oynat/duraklat/ileri/geri; "Bu sayfadan oku"; duraklatınca ilerleme kaydediliyor.
- [ ] Ekran kilitlenince okuma sürüyor; bildirimdeki **Duraklat** çalışıyor (Android 13+: bildirim izni isteniyor).
- [ ] Uygulama arka plana alınıp dönülünce arayüz durumu doğru (oynuyor/duruyor, doğru parça).
- [ ] Uygulama tamamen kapatılıp açılınca kitap kaldığı parçadan devam ediyor.
- [ ] Son parça bitince "Kitap bitti" ve ilerleme sıfırlanıyor.

**Ses dosyası (M4A)**
- [ ] Küçük kitapta oluşturma tamam; uygulama içi oynatıcıda çalıyor; süre/boyut doğru.
- [ ] Aynı ayarlarla tekrar açınca yeniden üretmeden "hazır" görünüyor; ses/hız değişince "eskidi" uyarısı.
- [ ] Oluşturma sırasında İptal → yarım dosya kalmıyor.
- [ ] Android 10+: "Müziğe kaydet" → Müzik/Kitap Seslendir klasöründe görünüyor (depolama izni istenmiyor). "Paylaş" menüsü açılıyor.
- [ ] Android 9 ve altı: "Müziğe kaydet" anlaşılır mesaj veriyor; "Paylaş" denenebiliyor.
- [ ] Düşük disk alanı: oluşturma/kaydetme "yeterli boş alan yok" mesajı veriyor.
- [ ] Oluşturma sırasında uygulama kapatılıp açılınca eski `.part` dosyası sonraki denemede temizleniyor.

**Kitaplık**
- [ ] Silince metin, PDF ve ses dosyası kalkıyor; depolama alanı geri geliyor.
- [ ] Depolama doluyken PDF eklemek anlaşılır hata veriyor, yarım kayıt kalmıyor.
