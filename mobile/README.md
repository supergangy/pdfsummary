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
| 3. 정리 방법 | 목차/쪽/색별 · 문맥 보충(AI 개요 · **기기 안 AI** · 앞뒤 문장) · 손글씨 처리 |
| 결과 | 앱 안에서 바로 보기, 공유(HTML) · Markdown+이미지(zip) → 파일 앱·노션·카톡 등으로 |

## 기기 안 AI (API 키 없이 무료)

Claude API 키가 없어도, 기기에 들어 있는 AI로 **단원 개요와 표시마다 한 줄 설명**을 붙일 수 있습니다.
**3. 정리 방법 → 문맥 보충 → 기기 안 AI**를 고르면 됩니다 (이 기기에서 쓸 수 있을 때만 보입니다).

| 기기 | 쓰는 AI | 조건 |
|---|---|---|
| 아이패드·아이폰 | Apple 기기 안 AI (Foundation Models) | iPadOS·iOS 26 이상, Apple Intelligence 지원 기기, 설정에서 Apple Intelligence 켜기 |
| 갤럭시 등 안드로이드 | Gemini Nano (ML Kit Prompt API, AICore) | 지원 기기만 (Galaxy Z Fold7, S26 시리즈 등 일부. 갤럭시탭은 아직 목록에서 못 봄). 처음에 모델을 한 번 받음 |

```
[앱] ──PDF──▶ [서버: 표시 찾기·목차 정리 + 기기 AI용 짧은 일감] ──일감──▶ [앱: 기기 안 AI가 답 쓰기] ──답──▶ [서버: 요약에 넣기]
```

- 인터넷 AI로 보내지 않고, 비용도 없습니다. 책 본문 일부와 표시한 문장은 기기 안에서만 AI가 읽습니다.
- 기기 안 AI는 한 번에 읽을 수 있는 양이 적어서(4천 토큰쯤), 단원마다 본문 일부(약 1,400자)와 표시 6개씩만 보냅니다. Claude의 **핵심 정리 요약집**처럼 표·예상 문제까지 만드는 일은 하지 못합니다.
- 안드로이드는 앱이 화면에 떠 있을 때만 돌므로, 끝날 때까지 앱을 켜 두세요. 진행 중에 **여기까지만 넣기**를 누르면 그때까지 쓴 설명만 넣습니다.
- 손글씨 그림은 기기 안 AI가 보지 못합니다 (원본 이미지로 들어갑니다).
- 기기 안 AI 모듈은 `modules/device-ai/`에 있습니다 (iOS: Swift, Android: Kotlin). Expo Go·웹에는 없어서 그곳에서는 이 선택지가 보이지 않습니다. 안드로이드 최소 버전은 8.0(API 26)입니다.

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
                      # 기기 안 AI 일감 처리(길면 짧은 판, 바쁘면 한 번 더, 못 쓰면 멈춤)도 가짜 AI로 시험
```

네이티브 코드(기기 안 AI 모듈)는 GitHub Actions의 **앱 네이티브 빌드**에서 실제 Android(Gradle)·iOS(Xcode 26)로 빌드해 컴파일을 확인합니다. 실제 기기에서 AI가 답하는 것은 지원 기기에서 직접 확인해야 합니다.

| 파일 | 하는 일 |
|---|---|
| `App.tsx` | 화면 전체 (PDF 고르기 → 색 → 정리 방법 → 진행 → 결과) |
| `src/api.ts` | 서버와 대화 (화면과 분리, Node로 시험) |
| `src/deviceRun.ts` | 서버가 준 일감을 기기 안 AI로 하나씩 처리 (Node로 시험) |
| `modules/device-ai/` | 기기 안 AI 네이티브 모듈: iOS `ios/DeviceAiModule.swift`, Android `android/…/DeviceAiModule.kt` |
| `src/SettingsSheet.tsx` | 설정 |
| `src/ui.tsx` | 카드·버튼·선택 버튼 같은 부품, 밝은/어두운 색 |
| `src/platform/*.ts(x)` | 기기용과 웹용이 다른 부분 (`.web.ts`가 웹용): 업로드, 설정 저장, 공유받기, 결과 보기, 결과 공유 |
