#!/usr/bin/env bash
# NativeTTSPlugin'in kuyruk ve dışa aktarma mantığını Android olmadan, JVM'de (JDK 17+) dener.
# Android/Capacitor/TextToSpeech sınıfları stubs/ içindeki SAHTE karşılıklarla değiştirilir; sahte TTS motoru
# kuyruğu sırayla "çalar" ve gerçek motordaki geri çağrım sırasını taklit eder.
# Bu bir derleme/mantık denetimidir; gerçek Android API'si ve gerçek TTS motoru yerine geçmez (docs/TEST-PLAN.md B bölümü).
set -euo pipefail
cd "$(dirname "$0")"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
if command -v javac >/dev/null 2>&1; then JAVAC=(javac); else JAVAC=(java -m jdk.compiler/com.sun.tools.javac.Main); fi
"${JAVAC[@]}" -nowarn -d "$OUT" \
  $(find stubs -name '*.java') \
  ../../android-template/java/NativeTTSPlugin.java \
  ../../android-template/java/WavReader.java \
  QueueTest.java
java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "$OUT" com.kitapseslendir.app.QueueTest
