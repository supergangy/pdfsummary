#!/usr/bin/env bash
# 안드로이드 에뮬레이터에서 APK를 설치·실행해 본다: 꺼지지 않는지, 첫 화면(노트 목록)이 그려지는지.
#   scripts/smoke-android.sh <apk> <결과 폴더>
set -u
apk="$1"; out="$2"; pkg=com.supergangy.pdfsummary
mkdir -p "$out"
adb wait-for-device
adb shell getprop ro.product.cpu.abilist
adb install -r "$apk" || { echo "설치 실패"; exit 1; }
adb logcat -c
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null
ok=""
for i in $(seq 1 30); do
  sleep 3
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml "$out/ui.xml" >/dev/null 2>&1
  if grep -q "필기 노트" "$out/ui.xml" 2>/dev/null; then ok=1; break; fi
  adb shell pidof "$pkg" >/dev/null || break
done
sleep 3
adb exec-out screencap -p > "$out/screen.png"
adb logcat -d > "$out/logcat.txt"
if grep -q "FATAL EXCEPTION" "$out/logcat.txt"; then
  echo "앱이 죽음:"; grep -A40 "FATAL EXCEPTION" "$out/logcat.txt" | head -80; exit 1
fi
adb shell pidof "$pkg" >/dev/null || { echo "앱이 꺼짐"; grep -E "ReactNativeJS|AndroidRuntime|libc" "$out/logcat.txt" | tail -60; exit 1; }
if [ -z "$ok" ]; then
  echo "첫 화면(노트 목록)이 보이지 않음"; grep -E "ReactNativeJS" "$out/logcat.txt" | tail -40; exit 1
fi
grep -E "ReactNativeJS.*(Error|Exception)" "$out/logcat.txt" | head -20 || true
echo "✓ 설치·실행·첫 화면 확인"
