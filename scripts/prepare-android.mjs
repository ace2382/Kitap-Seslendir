// Android projesini hazırlar (yerelde ve GitHub Actions'ta aynı betik çalışır):
//   1) `android/` yoksa Capacitor ile üretir
//   2) Java eklentisini, servisi ve ikonları kopyalar
//   3) AndroidManifest.xml'e <queries>, izinler ve servisi ekler
//   4) `cap sync` ile web çıktısını Android'e aktarır
// Önce `npm run build` çalıştırılmış olmalıdır (dist/ gerekir).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchManifest, verifyManifest } from "./manifest-patch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(root, "android");
const template = path.join(root, "android-template");
const javaTarget = path.join(androidDir, "app/src/main/java/com/kitapseslendir/app");
const resTarget = path.join(androidDir, "app/src/main/res");
const manifestPath = path.join(androidDir, "app/src/main/AndroidManifest.xml");

function run(args) {
  const r = spawnSync("npx", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\n✗ "npx ${args.join(" ")}" başarısız oldu.`);
    process.exit(r.status ?? 1);
  }
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(root, "dist/index.html"))) {
  fail("dist/ bulunamadı. Önce `npm run build` çalıştır.");
}

if (!fs.existsSync(androidDir)) {
  console.log("→ android/ üretiliyor (npx cap add android)");
  run(["cap", "add", "android"]);
} else {
  console.log("→ android/ zaten var; yalnızca eklenti dosyaları güncelleniyor");
}

if (!fs.existsSync(manifestPath)) fail("android/app/src/main/AndroidManifest.xml üretilemedi.");

console.log("→ Java dosyaları kopyalanıyor");
fs.mkdirSync(javaTarget, { recursive: true });
for (const file of fs.readdirSync(path.join(template, "java"))) {
  if (file.endsWith(".java")) fs.copyFileSync(path.join(template, "java", file), path.join(javaTarget, file));
}

if (fs.existsSync(path.join(template, "res"))) {
  console.log("→ ikonlar kopyalanıyor");
  fs.cpSync(path.join(template, "res"), resTarget, { recursive: true, force: true });
}

console.log("→ AndroidManifest.xml yamalanıyor");
const before = fs.readFileSync(manifestPath, "utf8");
const { xml, changes } = patchManifest(before);
if (changes.length) fs.writeFileSync(manifestPath, xml);
const problems = verifyManifest(fs.readFileSync(manifestPath, "utf8"));
if (problems.length) fail(`Manifest doğrulaması başarısız:\n  - ${problems.join("\n  - ")}`);
console.log(changes.length ? `  eklendi: ${changes.join(", ")}` : "  zaten güncel");

console.log("→ npx cap sync android");
run(["cap", "sync", "android"]);

console.log("\n✓ Android projesi hazır. Debug APK için:  cd android && ./gradlew assembleDebug");
