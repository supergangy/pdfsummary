# 필기 요약 — 태블릿·폰 앱 (iOS · Android)

아이패드·갤럭시탭·폰에서 필기한 PDF를 골라(또는 굿노트·삼성노트에서 **공유 → 필기 요약**) 요약본을 만드는 앱입니다.
PDF 분석은 파이썬이라 기기에서 돌릴 수 없어서, **앱 → 내 서버**로 보내 분석하고 결과를 받아 보여 줍니다.

```
[앱] ──PDF·옵션──▶ [필기 요약 서버 (pdfsummary-app --server)] ──(선택) 손글씨·단원 본문──▶ Claude API
     ◀──요약 HTML/zip──
```

| 화면 | 하는 일 |
|---|---|
| 설정 | 서버 주소 · 접속 코드 · 내 Claude API 키(선택). 기기의 보안 저장소(키체인/키스토어)에 저장 |
| 1. PDF 고르기 | 필기한 PDF + 필기 전 원본(선택). 다른 앱에서 공유받은 PDF도 여기로 |
| 2. 형광펜 색 | 서버가 찾은 색을 예시 문장과 함께 보여 줌. 내 색만 켜고, 의미(핵심·정의…) 적기 |
| 3. 정리 방법 | 목차/쪽/색별 · 문맥 보충(AI 개요·앞뒤 문장) · 손글씨 처리 |
| 결과 | 앱 안에서 바로 보기, 공유(HTML) · Markdown+이미지(zip) → 파일 앱·노션·카톡 등으로 |

## 1. 서버 먼저

앱이 붙을 서버가 있어야 합니다. 저장소 루트 README의 **"앱용 서버"**를 보세요. 띄운 뒤 서버 주소(https://…)와 접속 코드를 앱 설정에 넣습니다.

## 2. 개발용으로 기기에서 돌려 보기

공유받기(`expo-share-intent`)가 기기 고유 기능이라 **Expo Go로는 안 되고** 개발용 빌드가 필요합니다.

```bash
cd mobile
npm install
```

맥에 Xcode / Android Studio가 있으면 바로:

```bash
npx expo run:ios       # 또는 npx expo run:android
```

없으면 [EAS](https://expo.dev/eas)로 클라우드에서 빌드합니다 (Expo 계정 필요, 무료 등급 있음):

```bash
npx eas-cli login
npx eas-cli build --profile development --platform android   # 설치 파일(APK) 링크가 나옴
npx eas-cli build --profile development --platform ios       # 등록한 아이폰·아이패드에 설치
npx expo start --dev-client
```

브라우저로 화면만 빠르게 보려면 `npx expo start --web` (공유받기 · 파일 공유는 웹에서 안 됨).

## 3. 스토어에 올리기

| | 필요한 것 |
|---|---|
| App Store (아이패드·아이폰) | [Apple Developer Program](https://developer.apple.com/programs/) (연 99달러), 심사 |
| Google Play (갤럭시) | [Play Console](https://play.google.com/console) (1회 25달러), 심사 |

1. `app.json`의 `ios.bundleIdentifier`, `android.package`(지금은 `com.supergangy.pdfsummary`)를 내 것으로 정합니다. 한 번 올리면 바꿀 수 없습니다.
2. 빌드하고 제출합니다.

   ```bash
   npx eas-cli build --profile production --platform all
   npx eas-cli submit --platform ios
   npx eas-cli submit --platform android
   ```

3. 심사용 메모: 앱이 사용자의 PDF를 **사용자가 정한 서버**로 보낸다는 것, Claude API 키는 기기에만 저장된다는 것을 개인정보 처리 안내에 적어 두세요. 심사관이 써 볼 수 있게 시험용 서버 주소와 접속 코드도 같이 내야 합니다.

갤럭시탭만 쓴다면 스토어 없이 `--profile preview`로 만든 APK를 직접 설치해도 됩니다.

## 개발

```bash
npm run typecheck     # 타입 검사
npm test              # 실제 파이썬 서버(--server)를 띄워 앱의 서버 대화 코드를 시험 (저장소 루트에서 pip install . 필요)
```

| 파일 | 하는 일 |
|---|---|
| `App.tsx` | 화면 전체 (PDF 고르기 → 색 → 정리 방법 → 진행 → 결과) |
| `src/api.ts` | 서버와 대화 (화면과 분리, Node로 시험) |
| `src/SettingsSheet.tsx` | 설정 |
| `src/ui.tsx` | 카드·버튼·선택 버튼 같은 부품, 밝은/어두운 색 |
| `src/platform/*.ts(x)` | 기기용과 웹용이 다른 부분 (`.web.ts`가 웹용): 업로드, 설정 저장, 공유받기, 결과 보기, 결과 공유 |
