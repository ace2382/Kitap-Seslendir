# İmzalı (release) APK

Debug APK ile uygulamayı denemek yeterlidir. Mağazada/başkalarına dağıtım için kendi anahtarınızla imzalamanız gerekir.
**Keystore dosyasını ve parolaları asla repoya koymayın; kaybederseniz uygulamayı güncelleyemezsiniz — yedekleyin.**

## 1) Keystore üretin (bir kez, kendi bilgisayarınızda)

```bash
keytool -genkeypair -v -keystore kitap-seslendir.jks -alias kitapseslendir \
  -keyalg RSA -keysize 4096 -validity 10000
```

## 2) GitHub Secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Değer |
|---|---|
| `KEYSTORE_BASE64` | `base64 -w0 kitap-seslendir.jks` çıktısı (macOS: `base64 -i kitap-seslendir.jks`) |
| `KEYSTORE_PASSWORD` | keystore parolası |
| `KEY_ALIAS` | `kitapseslendir` |
| `KEY_PASSWORD` | anahtar parolası |

## 3) Çalıştırın

Actions → **Build signed release APK** → *Run workflow*. Çıktı: `kitap-seslendir-release` artifact'i
(zipalign + apksigner ile imzalanıp doğrulanır, SHA-256 yazdırılır).

## Yerelde imzalama (isteğe bağlı)

```bash
npm run build && npm run android:prepare
cd android && ./gradlew assembleRelease && cd ..
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
$BT/zipalign -p -f 4 android/app/build/outputs/apk/release/app-release-unsigned.apk aligned.apk
$BT/apksigner sign --ks kitap-seslendir.jks --out kitap-seslendir-release.apk aligned.apk
$BT/apksigner verify --verbose kitap-seslendir-release.apk
```

> Not: `release-apk.yml` bu geliştirme ortamında çalıştırılamadı (ağ/Android SDK yok); ilk kullanımda log'u kontrol edin.
