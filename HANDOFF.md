# 인수인계서 — 작업을 이어가는 사람을 위한 안내

> 마지막 정리: **2026-11-21** · 브랜치 `claude/eager-galileo-06vzez` · 마지막 기능 커밋 `36475a6`
> 이 문서만 읽으면 VS Code에서 바로 이어서 작업할 수 있도록 썼습니다. 기능 설명서는 [README.md](README.md)(PC·서버)와 [mobile/README.md](mobile/README.md)(앱)에 있습니다.

---

## 0. 한눈에 보기

| 항목 | 지금 상태 |
|---|---|
| 무엇 | PDF·종이책 스캔본에 **내가 표시한 부분(형광펜·밑줄·동그라미·손글씨)만 뽑아 요약**해 주는 프로그램 + 그 위에서 쓰는 **필기 앱** |
| 구성 | ① 파이썬 프로그램(`pdfsummary/`): 명령줄 · 끌어다 놓기 실행 화면 · 설치 앱(Windows/Mac) · **앱용 서버**(요약·동기화·계정) ② 필기 앱(`mobile/`, Expo): 아이패드·갤럭시탭·폰·웹 |
| 브랜치 | 모든 작업은 `claude/eager-galileo-06vzez`에만 있음. **main에 합치지 않았고 PR도 없음** |
| 자동 점검(CI) | 마지막 커밋 기준 **모두 통과**: 파이썬 시험, 앱 타입 검사·단위 시험(60개), 웹 e2e 2종, 안드로이드 APK 빌드, 에뮬레이터 실행 시험, iOS 빌드 |
| 설치 파일 | 갤럭시탭용 APK (빌드 19): **https://github.com/supergangy/pdfsummary/releases/latest/download/pdfsummary.apk** (항상 최신, 로그인 없이) |
| 실제 기기 | 갤럭시탭 SM-X820(안드로이드 17)에 **빌드 19를 깔아 확인 시작** (2026-11-21, 무선 디버깅). 필기 사라짐·S펜 단추 지우개는 **고쳐진 것 확인**. 손글씨 받침 줄 나누기·도구 설정 창 자리는 고쳐서 빌드 20으로 확인할 차례. 나머지는 §6 P0 표 |
| 서버 | 코드·Docker 이미지 정의는 완성. **아직 어디에도 배포하지 않음** |
| 저장소 공개 | **공개(public)**. 첫 공개 커밋 2026-10-31 → 특허를 낼 거라면 기한이 있음 (§6 P1) |

---

## 1. 처음 받기 (pull)

```bash
git clone https://github.com/supergangy/pdfsummary.git
cd pdfsummary
git checkout claude/eager-galileo-06vzez
```

이미 받아 둔 저장소라면:

```bash
git fetch origin claude/eager-galileo-06vzez
git checkout claude/eager-galileo-06vzez
git pull
```

> main 브랜치에는 이 작업들이 없습니다. main으로 합칠지(PR)는 아직 정하지 않았습니다 (§6 P1).

---

## 2. 개발 환경 준비 (VS Code)

### 2-1. 꼭 필요한 것

| 도구 | 버전 | 용도 |
|---|---|---|
| Python | 3.10 이상 (CI는 3.12) | 요약 프로그램·서버 |
| Node.js | 22 (CI와 같게) | 필기 앱 |
| Git | — | |

VS Code에서 저장소를 열면 오른쪽 아래에 **추천 확장 설치** 알림이 뜹니다(`.vscode/extensions.json`). Python, Pylance, Expo Tools, Kotlin, Swift 문법 지원, Playwright 등입니다.

### 2-2. 파이썬 쪽

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -e '.[dev]'
python -m pdfsummary.ocr --download --dest ocr_models   # 스캔본 글자 인식 모델 (시험에 필요, 한 번만)
export PDFSUMMARY_MODELS=$PWD/ocr_models                # Windows PowerShell: $env:PDFSUMMARY_MODELS="$PWD\ocr_models"
pytest -q
```

VS Code: `Ctrl+Shift+P → Python: Select Interpreter → .venv`.

### 2-3. 앱 쪽

```bash
cd mobile
npm install          # postinstall이 pdf.js·Skia 웹 파일을 public/에 복사함
npm run typecheck    # 타입 검사
npm test             # 단위 시험 (Node 내장 시험기, 60개)
```

`npm test`의 서버 대화 시험은 파이썬 서버를 띄우므로 **저장소 루트에서 `pip install -e .`가 되어 있어야** 합니다.

### 2-4. (선택) 실기기·빌드용

| 하려는 것 | 필요한 것 |
|---|---|
| 안드로이드 APK를 내 컴퓨터에서 빌드 | Android Studio(SDK) + JDK 17. **보통은 필요 없음** — GitHub에 올리면 CI가 APK를 만들어 릴리스에 올림 |
| 갤럭시탭에 USB/무선으로 바로 설치·로그 보기 | Android SDK Platform-Tools(`adb`) |
| 아이패드 | Mac + Xcode 26, 그리고 실기기·TestFlight에는 Apple Developer 계정(연 99달러) |
| 웹 e2e 시험 | `cd mobile && npm install --no-save playwright@1.63.0 && npx playwright install chromium` |

---

## 3. 자주 쓰는 명령

### 3-1. 시험

```bash
# 파이썬 전체 (루트에서)
pytest -q

# 앱 단위 시험·타입 검사
cd mobile && npm run typecheck && npm test

# 앱 웹판을 실제 브라우저로 (필기·지우개·도구 설정·요약 / 다섯 기기 동기화·계정·Google 로그인)
cd mobile
npx expo export --platform web --output-dir dist-web
node e2e/notes.e2e.cjs dist-web
node e2e/sync.e2e.cjs dist-web
```

e2e는 실패하면 화면 캡처 경로를 출력합니다. `notes.e2e.cjs`는 `E2E_DEBUG=1`을 붙이면 브라우저 콘솔도 출력합니다.

### 3-2. 내 컴퓨터에서 서버 + 앱 웹판으로 써 보기

```bash
# 터미널 1: 앱용 서버 (메일은 실제로 보내지 않고 폴더에 .eml로 남김)
PDFSUMMARY_SYNC_DIR=/tmp/pdfsync PDFSUMMARY_MAIL_DIR=/tmp/pdfmail \
  python -m pdfsummary.app --server --host 127.0.0.1 --port 8080 --access-code 아무거나-8자-이상

# 터미널 2: 앱 웹판
cd mobile && npx expo start --web
```

앱에서 **설정 → 서버 주소 `http://127.0.0.1:8080`, 접속 코드** 입력 → **☁️ 동기화**로 계정 가입·로그인을 시험할 수 있습니다. 가입 확인 코드는 `/tmp/pdfmail/*.eml`에 있습니다.

### 3-3. PC 요약 프로그램

```bash
python examples/make_sample.py sample.pdf
pdfsummary sample.pdf                 # 명령줄
pdfsummary-app                        # 끌어다 놓기 실행 화면 (브라우저가 열림) = python -m pdfsummary.app
```

### 3-4. 갤럭시탭 APK

- **평소**: `mobile/**`을 바꿔 push하면 CI가 자동으로 ① APK 빌드 ② 에뮬레이터에 설치해 첫 화면까지 확인 ③ 릴리스 `android-<번호>` 생성. 태블릿에서는 위 고정 주소로 받으면 됩니다. 덮어 설치되고 노트는 남습니다.
- **내 컴퓨터에서 직접** (Android SDK 필요):

  ```bash
  cd mobile
  npx expo prebuild --platform android --no-install
  cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
  adb install -r app/build/outputs/apk/release/app-release.apk
  ```

  `mobile/android/`, `mobile/ios/`는 만들어지는 폴더라 git에 올리지 않습니다(.gitignore).
- **무선 디버깅으로 설치·로그** (태블릿과 같은 와이파이의 컴퓨터에서):

  ```bash
  adb pair 192.168.0.12:37123 123456        # 태블릿: 개발자 옵션 → 무선 디버깅 → 페어링 코드로 페어링
  adb connect 192.168.0.12:41234            # 무선 디버깅 첫 화면의 IP:포트
  bash mobile/scripts/smoke-android.sh pdfsummary.apk 결과   # 설치·실행·꺼짐 확인·화면 캡처 (맥·리눅스)
  adb logcat -d > logcat.txt                # 앱이 꺼지면 이 기록에서 FATAL EXCEPTION 찾기
  ```

---

## 4. 코드 지도 (어디를 고치면 되나)

전체 표는 [README.md의 개발](README.md#개발)·[mobile/README.md의 개발](mobile/README.md#개발)에 있습니다. 최근에 생긴 것과 자주 손대는 곳만:

### 4-1. 파이썬 (`pdfsummary/`)

| 파일 | 하는 일 |
|---|---|
| `extract.py` · `strokes.py` · `scan.py` · `diff.py` · `colors.py` | 표시 찾기 (주석·펜 획·스캔 형광펜 색·원본 비교) — **이 프로그램의 핵심** |
| `pagetext.py` · `ocr.py` | 영역 안 글자 꺼내기, 스캔본 글자 인식(RapidOCR) |
| `organize.py` · `outline.py` · `booklet.py` · `render*.py` | 정리·목차·요약집 만들기 |
| `ai.py` · `local_ai.py` | Claude / 내 컴퓨터 AI(Ollama) |
| `app.py` | 실행 화면 + **앱용 서버**(모든 HTTP 엔드포인트) |
| `sync.py` | 실시간 동기화 저장소 (SQLite 작업 기록, 오래 기다리기, PDF 내용 주소) |
| `accounts.py` | 계정·세션·가입 확인/비밀번호 찾기 메일 코드·Google 계정 잇기, 관리자 명령(`python -m pdfsummary.accounts …`) |
| `mailer.py` | SMTP 메일 (`PDFSUMMARY_SMTP_*`, 시험용 `PDFSUMMARY_MAIL_DIR`) |
| `google_auth.py` | Google ID 토큰 확인 (RS256 서명을 파이썬만으로, JWKS 기억) |
| `notes.py` · `device_ai.py` | 앱 노트 → 요약용 PDF, 기기 안 AI 일감 |

### 4-2. 앱 (`mobile/`)

| 파일 | 하는 일 |
|---|---|
| `App.tsx` | 화면 전환 (목록 · 필기 · 바로 요약 · 서버 요약) |
| `src/notes/Editor.tsx` | 필기 화면: 도구 모음, 저장(700ms 뒤 자동), 지우개(획/영역), 올가미, 글상자, 형광펜 글줄 맞추기 |
| `src/notes/PageCanvas.tsx` | Skia 그림판 + 펜 입력(UI 스레드 워크릿), **S펜 단추** 처리 |
| `src/notes/ToolPanel.tsx` | 도구 설정 창 (펜 종류·굵기·선 모양·색 / 형광펜 / 지우개 / 올가미) |
| `src/notes/geometry.ts` | 획 윤곽(펜 종류별), **`strokeDraw`(화면·PDF·요약이 모두 이걸로 그림)**, 영역 지우개 `eraseFrom`, 형광펜 `fitHighlight` |
| `src/notes/model.ts` | 노트·획 데이터 모양 (획에 `brush`·`dash`·`opacity`는 선택 칸 → 예전 노트와 호환) |
| `src/notes/history.ts` | 되돌리기 (add/remove/replace/**split**) |
| `src/notes/fileFs.ts` · `fs.ts` | **기기 파일 저장** (§5-1 교훈) |
| `src/notes/quick.ts` · `QuickScreen.tsx` | 바로 요약 (형광펜/밑줄/동그라미/손글씨/메모/표시, 손글씨 줄 나누기) |
| `src/notes/sync/*` | 동기화 엔진·계정·Google 버튼·동기화 화면 |
| `modules/pdf-pages/` | PDF 쪽 크기·그림·글자 + **글자 인식(OCR) `ocrAsync`** (Android ML Kit 한국어 `OcrText.kt`, iOS Vision) |
| `modules/ink-recognizer/` | 손글씨 인식 (Android ML Kit Digital Ink + 쓴 자리 크기, iOS Vision) |
| `modules/stylus/` | **S펜 옆 단추 감싸개** (Android 네이티브 뷰, 웹은 포인터 단추) |
| `modules/device-ai/` | 기기 안 AI (iOS Foundation Models, Android ML Kit Prompt) |
| `app.config.js` | 빌드 때 정하는 값: iOS Google 로그인 URL scheme(`GOOGLE_IOS_CLIENT_ID`), APK 버전 번호(`ANDROID_VERSION_CODE`) |
| `scripts/smoke-android.sh` | APK 설치·실행·첫 화면 확인 (CI 에뮬레이터와 실기기 둘 다) |

### 4-3. 자동 점검 (`.github/workflows/`)

| 파일 | 언제 | 하는 일 |
|---|---|---|
| `ci.yml` (점검) | 모든 push | 파이썬 시험(실제 글자 인식 포함), 앱 타입 검사·단위 시험·번들, 웹 e2e 2종, 실제 Ollama 시험 |
| `mobile-native.yml` (앱 네이티브 빌드) | `mobile/**` push | 안드로이드 APK → 모듈 확인 → **에뮬레이터 실행 시험** → **릴리스**(최근 5개 유지) / iOS 시뮬레이터 빌드 |
| `desktop.yml` (설치 앱 만들기) | `v*` 태그 push 또는 수동 | Windows .exe / Mac .app (PyInstaller). **최근에는 돌리지 않았음** |

---

## 5. 지켜 온 약속 · 꼭 알아야 할 결정

### 5-1. 반드시 지킬 것

1. **화면 글은 쉬운 한국어로.** 사용자는 한국어 사용자이고 개발자가 아닙니다. 코드 주석도 한국어로 써 왔습니다.
2. **사용자 교재 PDF는 절대 올리지 않기** (저작권). 시험은 `examples/make_sample.py`로 만든 PDF만 씁니다.
3. **비밀값(API 키·비밀번호·서명 키)은 저장소에 넣지 않기.** 서버는 환경 변수, 앱은 기기 보안 저장소(SecureStore)에 둡니다.
4. **기능을 바꾸면 시험도 같이**: 계산은 `*.test.ts`/`tests/test_*.py`, 화면 흐름은 e2e. **CI가 초록색이어야 push 완료**로 봅니다.
5. **기기 파일 저장은 반드시 `await`** — expo-file-system 58의 `write()`·`move()`·`copy()`는 비동기입니다. 이걸 기다리지 않아 **"요약 갔다 오면 필기가 사라지는" 큰 버그**가 실제로 났습니다. 저장은 `fileFs.ts`만 거치세요 (끝까지 쓴 뒤 덮어쓰기 이동, 같은 파일은 차례대로). `fileFs.test.ts`가 지켜 줍니다.
6. **획 데이터는 뒤로 호환**: 새 속성은 선택 칸으로만 더하기. 다른 기기(예전 앱)와 동기화되고, 예전 노트도 열려야 합니다.

### 5-2. 이유가 있는 설정 (함부로 바꾸지 말 것)

| 설정 | 이유 |
|---|---|
| `app.json` → `enableMinifyInReleaseBuilds: false` | Expo 58 기본은 R8로 코드 줄이기. 우리 모듈·Skia·Google 로그인이 R8 규칙 아래서 검증 안 됨 → 켜면 실기기에서 켜자마자 꺼질 위험 |
| `app.json` → `useLegacyPackaging: true` | 네이티브 라이브러리를 설치할 때 풀어 둠. 끄면 x86 에뮬레이터(ARM 번역)에서 `libreactnative.so`를 못 찾아 시작 직후 꺼짐 (에뮬레이터 시험이 실제로 잡음) |
| APK 서명 = 템플릿의 공용 `debug.keystore` | 빌드마다 서명이 같아 덮어 설치(노트 유지) 가능. 대신 **누구나 같은 키로 서명 가능 → 개인 시험용**. 스토어는 자기 키 필요 (§6 P1) |
| `@react-native-google-signin/google-signin` **17.0.0** 고정 | 버전을 바꾸면 iOS 플러그인·안드로이드 동작을 다시 확인해야 함 |
| ML Kit: `digital-ink-recognition:19.0.0`(패키지 경로 `…digitalink.recognition`), `text-recognition-korean:16.0.1` | 19에서 패키지 경로가 바뀌었던 적 있음 (CI가 잡음) |
| 웹: `metro.config.js`의 tslib, `boot.web.ts`의 Skia 먼저 불러오기, `public/pdfjs`의 cmaps | 웹판이 깨지던 문제들의 해결책 |

### 5-3. 동기화·계정 동작 (요약)

- 노트 정보·쪽·획·폴더가 각각 '값 칸'. 서버 차례 번호(seq)가 큰 쓰기가 이김. 아직 서버에 안 간 내 쓰기는 남의 쓰기로 덮지 않음. 지운 노트는 되살아나지 않음.
- 동기화를 켤 때는 **서버 내용을 먼저 받고 이 기기에만 있던 것만 올림** (오래된 사본이 새 내용을 덮지 않게).
- 계정: 이메일+비밀번호(scrypt), 가입 확인 메일 코드, 비밀번호 찾기 메일 코드, Google 로그인(같은 이메일 계정에 이어 붙임, 이메일 미확인 계정이면 예전 비밀번호·로그인 모두 끊음), 기기 목록·로그아웃시키기.
- 서버 접속 코드(`PDFSUMMARY_ACCESS_CODE`)가 있어야 가입·로그인도 됨 (아무나 못 들어오게).

---

## 6. 남은 일 (우선순위 순)

### P0 — 실기기에서 바로 확인해야 할 것 (코드는 다 됐음)

> 사용자가 갤럭시탭에서 처음 써 보고 알려 준 4가지를 빌드 19에서 고쳤습니다. 2026-11-21에 갤럭시탭 SM-X820(안드로이드 17)에서 확인을 시작했습니다 — 아래 **✅는 실기기에서 확인된 것**, 나머지는 아직입니다. §7 체크리스트대로 확인하고, 안 되면 `adb logcat`을 받아 고칩니다.

| # | 확인할 것 | 안 되면 볼 곳 |
|---|---|---|
| 1 | ✅ 요약에 갔다 와도, 앱을 강제로 껐다 켜도 필기가 남음 (빌드 19). **예전에 사라졌던 필기가 되살아나는지**(`.tmp` 되살리기)는 아직 모름 | `src/notes/fileFs.ts` |
| 2 | ✅ **S펜 옆 단추를 누른 채 문지르면 지우개** (빌드 19). 쓰다가 중간에 누르는 경우는 아직 확인 전 | `modules/stylus/android/.../StylusModule.kt` — 삼성 기기가 단추를 `BUTTON_STYLUS_PRIMARY`가 아닌 다른 값으로 보낼 수 있음. `Log.d`로 `ev.buttonState`·`getToolType`을 찍어 확인. 떠 있을 때 단추를 누르면 삼성 **Air command**가 먼저 가로챌 수도 있음 |
| 3 | **바로 요약의 형광펜 글자**: 칠한 글자는 맞게 나옴. 다만 앞뒤 문장에서 **붙어야 할 글자가 떨어지고**("사용자 가", "자 원", "하드웨 어") **보기 번호 ①②③④가 "0", "3", "2."로 읽히며 순서가 섞임** → 아직 안 고침 | `modules/pdf-pages/.../OcrText.kt` (낱말 상자를 글자 수로 나눔 — 두 단 편집·작은 글씨에서 어긋날 수 있음), 렌더 폭 2200px(`index.ts`), `quick.ts`의 `join`·`sentenceAround` |
| 4 | **손글씨 인식**: "안녕"이 "아녀" + "U" 두 줄로 읽힘 → 받침이 아랫줄로 떨어져 나가던 것을 고침(`sameLine`, 쓴 차례가 두 줄을 오가면 한 줄). **빌드 20에서 실기기 확인 필요** | `quick.ts`의 `splitInkLines`·`sameLine`, `InkRecognizerModule.kt`의 `WritingArea` |
| 5 | 펜 반응 속도·필압·손바닥 무시, 펜 종류별 느낌 | `PageCanvas.tsx`, `geometry.ts`의 `penOutline` |
| 6 | 큰 PDF(수백 쪽)에서 속도·메모리, 한글 PDF가 PdfRenderer에서 제대로 그려지는지 | `modules/pdf-pages`, `Editor.tsx`의 쪽 그림 미리 불러오기 |
| 7 | **도구 설정 창**이 도구 모음을 가리고, 도구 단추를 빠르게 두 번 누르면 떴다가 바로 닫힘 → 도구 모음 바로 밑·누른 단추 왼쪽 끝에 맞춰 뜨고, 막 열렸을 때의 바깥 누름은 넘기게 고침. **빌드 20에서 실기기 확인 필요** | `ToolPanel.tsx`의 `at`·`closeOutside`, `Editor.tsx`의 `openPanel` |

### P1 — 출시·운영에 필요한 것 (사람이 결정·설정해야 함)

1. **서버 배포**: Docker 이미지(`Dockerfile`)로 https가 되는 곳(Render·Fly.io·Cloud Run 등)에 올리기. **`/data`를 디스크(볼륨)로** 연결해야 동기화 기록이 안 사라짐. 환경 변수는 README의 "앱용 서버" 표 참고. 백업 방법도 정하기(SQLite 파일 `sync.db` + `blobs/`).
2. **메일 서버 실제 설정**: `PDFSUMMARY_SMTP_*` 넣고 `python -m pdfsummary.accounts test-mail 받을주소`로 확인. (Gmail은 '앱 비밀번호')
3. **Google 로그인 실제 설정**: Google Cloud 콘솔에서 OAuth 동의 화면(프로덕션) + 클라이언트 ID 3종(웹·iOS·Android, 안드로이드는 **서명 키 SHA-1** 필요 → 자기 서명 키를 정한 뒤에). 절차는 README "필기 앱 Google 로그인 준비". 실기기에서 아직 한 번도 안 해 봄.
4. **자기 서명 키로 APK 만들기 → Play 스토어**: 지금은 공용 시험 키. 키를 만들어 GitHub 비밀값(Secrets)에 넣고 `mobile-native.yml`이 그 키로 서명하게 바꾸기. **키를 바꾸면 기존 설치본 위에 덮어 설치가 안 됨** (한 번 지우고 다시 설치 → 그 전에 동기화 켜거나 .pnote로 내보내 두기).
5. **아이패드**: Apple Developer 계정 → `eas build`/TestFlight. iOS Google 로그인은 빌드 때 `GOOGLE_IOS_CLIENT_ID` 필요.
6. **main으로 합칠지(PR)** 결정. 지금은 이 브랜치에만 있음.
7. **특허·법률** (사용자가 차별점으로 가져가고 싶어 함):
   - 저장소가 **2026-10-31부터 공개** → 한국 출원은 **공개 후 12개월 안에 '공지예외주장'**으로 (늦어도 2027-10 말 전, 빠를수록 좋음). 유럽 등은 사실상 이미 어려움.
   - 가까운 선행 특허: US7712028(표시한 부분만 뽑아 요약, 만료 추정), 제록스 형광펜 검출 계열(US5048109·5272764·5619592, 만료 추정), **US8494280(스캔본 형광펜 영역 추출, 살아 있을 수 있음)**, **US12008332(형광펜·주석 + LLM 요약, 2024 등록·유효)**, US20250378101(출원 중), KR101443404.
   - "표시 부분 추출 + AI 요약" 아이디어 자체는 특허받기 어려울 가능성. 차별 후보는 **책 인쇄 색 vs 내 형광펜 구분(원본 비교·색 지정)**, 표시 종류별 정리 + 앞뒤 문장 묶기, 글줄 맞춤 보정, 기기 안 요약 흐름.
   - **변리사 상담 + 출시 전 FTO(침해 여부) 검토** 필요. 저장소 비공개 전환도 고려.
8. **개인정보 처리 안내·약관**: 스토어 심사와 계정 기능에 필요 (PDF를 사용자가 정한 서버로 보냄, 이메일 저장, Google 로그인).

### P2 — 기능 다듬기 (삼성노트·굿노트와 비교해 아직 없는 것)

- 형광펜 **펜촉 모양**(삼성노트의 T 아이콘 3개), **즐겨찾는 펜**(⭐), **사용자 색 고르기**(색상환), 필압 곡선 설정
- 웹판: 펜 단추를 **누른 채 떠 있다가 닿으면** 그리기 자체가 시작되지 않음 (브라우저가 '오른쪽 단추 누름'으로 보냄. 쓰다가 누르는 건 됨). 태블릿 앱은 해당 없음
- 웹판에는 **글자 인식(OCR)이 없음** → 웹에서 스캔본 PDF의 형광펜 글자는 못 뽑음 (pdf.js 글자 층만)
- 영역 지우개가 **글상자**에 닿으면 글상자 통째로 지워짐
- 바로 요약: 화살표·괄호·별표 같은 표시 종류, 표시별 중요도
- 아이패드 손글씨 인식은 획을 그림으로 그려 Vision에 넘기는 방식 — 정확도 미확인
- 기기 안 AI(애플 Foundation Models·Gemini Nano) **실기기 확인 안 됨**
- 설치 앱(Windows/Mac) 빌드를 최근 돌리지 않음 → `v` 태그를 올려 한 번 확인

### P3 — 기술 부채

- `Editor.tsx`가 큼(약 850줄) → 지우개·올가미·글상자를 훅으로 나누기
- GitHub Actions의 `actions/*@v4`가 Node 20 지원 종료 경고 → 새 판으로 올리기
- 서버: 한 프로세스 + SQLite, 틀린 횟수 제한·메일 횟수 제한이 메모리에만 있음(재시작하면 초기화, 서버 여러 대면 따로 셈). 사용자가 늘면 Redis/DB로
- 웹판은 로그인 세션을 localStorage에 둠 → 웹을 공개 서비스로 열 거면 XSS 대비 점검
- e2e가 길고 `waitForTimeout`이 많음 → 가끔 느린 CI에서 흔들리면 기다림 조건으로 바꾸기

---

## 7. 갤럭시탭 실기기 점검표 (빌드 19 이상)

1. 위 고정 주소로 APK 받아 **덮어 설치** → 예전 노트가 그대로 있는지, **예전에 사라졌던 필기가 돌아왔는지**
2. 새 노트 → 펜으로 몇 줄 쓰기 → **요약** → `‹ 노트로` → **필기가 그대로인지** → 앱을 완전히 껐다 켜도 그대로인지
3. **S펜 옆 단추를 누른 채** 획 위를 문지르기 → 지워지는지 / 쓰다가 단추 누르기 → 그때부터 지워지는지
4. 펜 도구를 **한 번 더 눌러** 설정 창 → 볼펜·만년필·붓펜·연필·붓, 파선·점선, 굵기 → 견본과 실제 획이 같은지
5. 형광펜 설정 → 투명도, 직선 자동 보정, **글자 크기에 맞춰 두께 조절** 켜고 PDF 글줄 위에 비뚤게 칠하기 → 글줄에 딱 맞는지
6. 지우개 설정 → **영역 지우개**로 획 가운데만 지우기 → 되돌리기 한 번에 원래대로 / 형광펜만 지우기 / 이 쪽 모두 지우기
7. 올가미 → 사각형, 부분 선택 포함
8. **PDF 교재(가능하면 스캔본)** 에 형광펜·밑줄·동그라미·여러 줄 손글씨 → **요약** → 칠한 글자가 글자로 나오는지, 손글씨가 줄마다 맞게 읽히는지
9. 이상하면: §3-4대로 `adb logcat -d > logcat.txt` 받아서 같이 보기

---

## 8. 문제 생기면

| 증상 | 먼저 볼 것 |
|---|---|
| 앱이 켜자마자 꺼짐 | `adb logcat`에서 `FATAL EXCEPTION`. CI의 `android-smoke-<번호>` 아티팩트에 에뮬레이터 화면·로그가 있음 |
| CI 안드로이드 빌드 실패 | Gradle 의존성 버전(ML Kit 등)·패키지 경로. 로그 맨 끝의 `What went wrong` |
| CI iOS 빌드 실패 | `pod install` 단계 또는 Swift 컴파일. iOS 16 이상만 되는 API는 `#available`로 감싸기 |
| 웹 e2e 실패 | 출력된 `failure*.png` 화면. 버튼 이름을 바꿨다면 e2e의 `getByText`/`getByLabel`도 같이 |
| `npm test`의 서버 시험 실패 | 루트에서 `pip install -e .` 했는지, 포트가 겹치는지 |
| 파이썬 글자 인식 시험 건너뜀 | `PDFSUMMARY_MODELS`가 `ocr_models` 폴더를 가리키는지 |

---

## 9. Claude Code로 이어서 작업할 때

- 저장소 맨 위의 [`CLAUDE.md`](CLAUDE.md)를 Claude Code가 자동으로 읽습니다 (규칙·명령 요약).
- 이렇게 시작하면 빠릅니다:
  - "HANDOFF.md 읽고 P0 1번(필기 사라짐) 실기기 로그 보고 고쳐줘" + `logcat.txt` 첨부
  - "HANDOFF.md의 P2에서 형광펜 펜촉 모양 추가해줘. 시험과 e2e도"
  - "HANDOFF.md P1 4번: 내 서명 키로 APK 서명하게 workflow 바꿔줘" (키 파일·비밀번호는 채팅에 붙이지 말고 GitHub Secrets에 직접 넣기)
- 작업을 끝내면 이 문서의 **§0 표와 §6 남은 일**을 같이 고쳐 주세요.
