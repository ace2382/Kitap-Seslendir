// Capacitor'ın ürettiği AndroidManifest.xml'e uygulamanın ihtiyaç duyduğu parçaları ekler.
// Saf fonksiyondur (dosya erişimi yok) ve tekrar çalıştırılabilir (idempotent).

const TTS_QUERIES = `    <queries>
        <intent>
            <action android:name="android.intent.action.TTS_SERVICE" />
        </intent>
    </queries>

`;

const SERVICE = `
        <service
            android:name="com.kitapseslendir.app.PlaybackService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
`;

const PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  "android.permission.POST_NOTIFICATIONS"
];

export function patchManifest(xml) {
  if (!xml.includes("<application") || !xml.includes("</application>") || !xml.includes("</manifest>")) {
    throw new Error("AndroidManifest.xml beklenen biçimde değil (<application> veya </manifest> bulunamadı).");
  }
  const changes = [];
  let out = xml;

  // Android 11+ paket görünürlüğü: <queries> olmadan TTS motorları görünmeyebilir.
  if (!out.includes("android.intent.action.TTS_SERVICE")) {
    if (/<queries>/.test(out)) {
      out = out.replace(
        /<queries>/,
        `<queries>\n        <intent>\n            <action android:name="android.intent.action.TTS_SERVICE" />\n        </intent>`
      );
    } else {
      out = out.replace(/(\s*)<application/, (_m, ws) => `${ws.startsWith("\n") ? "\n" : "\n"}${TTS_QUERIES.trimEnd()}\n${ws.replace(/^\n/, "")}<application`);
    }
    changes.push("queries");
  }

  if (!out.includes("com.kitapseslendir.app.PlaybackService")) {
    out = out.replace("</application>", `${SERVICE.trimEnd()}\n    </application>`);
    changes.push("service");
  }

  const missing = PERMISSIONS.filter((p) => !out.includes(`"${p}"`));
  if (missing.length) {
    const lines = missing.map((p) => `    <uses-permission android:name="${p}" />`).join("\n");
    out = out.replace("</manifest>", `${lines}\n</manifest>`);
    changes.push(`permissions(${missing.length})`);
  }
  return { xml: out, changes };
}

export function verifyManifest(xml) {
  const problems = [];
  if (!xml.includes("android.intent.action.TTS_SERVICE")) problems.push("<queries> TTS_SERVICE eksik");
  if (!/<queries>[\s\S]*TTS_SERVICE[\s\S]*<\/queries>/.test(xml)) problems.push("TTS_SERVICE <queries> içinde değil");
  if (!xml.includes("com.kitapseslendir.app.PlaybackService")) problems.push("PlaybackService servisi eksik");
  for (const p of PERMISSIONS) if (!xml.includes(`"${p}"`)) problems.push(`${p} izni eksik`);
  return problems;
}
