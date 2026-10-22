import { describe, expect, it } from "vitest";
import { patchManifest, verifyManifest } from "./manifest-patch.mjs";

// Capacitor 7 şablonunun kısaltılmış hâli
const TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:theme="@style/AppTheme">

        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
            </intent-filter>
        </activity>

        <provider android:name="androidx.core.content.FileProvider" android:exported="false" />
    </application>

    <!-- Permissions -->

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

describe("patchManifest", () => {
  it("<queries>, servis ve izinleri ekler", () => {
    const { xml, changes } = patchManifest(TEMPLATE);
    expect(changes).toEqual(["queries", "service", "permissions(3)"]);
    expect(verifyManifest(xml)).toEqual([]);
  });
  it("<queries> bloğu <application>'dan önce gelir", () => {
    const { xml } = patchManifest(TEMPLATE);
    expect(xml.indexOf("<queries>")).toBeLessThan(xml.indexOf("<application"));
  });
  it("servis <application> içine girer", () => {
    const { xml } = patchManifest(TEMPLATE);
    expect(xml.indexOf("PlaybackService")).toBeLessThan(xml.indexOf("</application>"));
    expect(xml).toContain('android:foregroundServiceType="mediaPlayback"');
  });
  it("tekrar çalıştırılınca değişiklik yapmaz (idempotent)", () => {
    const once = patchManifest(TEMPLATE).xml;
    const twice = patchManifest(once);
    expect(twice.changes).toEqual([]);
    expect(twice.xml).toBe(once);
  });
  it("mevcut <queries> varsa içine ekler", () => {
    const withQueries = TEMPLATE.replace("<application", '<queries><package android:name="x" /></queries>\n    <application');
    const { xml } = patchManifest(withQueries);
    expect(verifyManifest(xml)).toEqual([]);
    expect(xml.split("<queries>").length - 1).toBe(1);
  });
  it("bozuk manifestte hata verir", () => {
    expect(() => patchManifest("<manifest></manifest>")).toThrow("beklenen biçimde değil");
  });
});

describe("verifyManifest", () => {
  it("yamasız şablonda eksikleri listeler", () => {
    expect(verifyManifest(TEMPLATE).length).toBeGreaterThan(3);
  });
});
