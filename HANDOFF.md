# 인수인계서 — 작업을 이어가는 사람을 위한 안내

> 마지막 정리: **2026-11-23** · 브랜치 `claude/eager-galileo-06vzez` · 최신 APK는 **빌드 48** (마이크 권한이 빠져 녹음이 안 되던 것 고침(사진 고르기 설정의 `microphonePermission: false`가 RECORD_AUDIO를 지웠음), 도구 모음을 왼쪽·오른쪽·떠 있게 하면 윗줄을 없애고 돌아가기·쪽 번호·요약도 도구 모음 안으로, 도구 모음 빈 곳 꾹 눌러 옮기기, 떠 있는 모양 한 줄·두 줄·세로, 노트·폴더 이름을 눌러 이름 바꾸기·꾹 눌렀다 떼면 메뉴, 즐겨찾기 별을 테두리 단추로. 빌드 47: **목록 화면: 즐겨찾기·휴지통·꾹 눌러 끌기** — 노트·폴더를 꾹 눌러 폴더에 넣기·노트 앞으로 순서 바꾸기·즐겨찾기·휴지통에 놓기, 휴지통은 30일 뒤 저절로 지움. 빌드 46: **강의 녹음**: 녹음하며 쓴 필기에 녹음 시각, 재생 막대의 '필기 눌러 듣기'로 그 필기를 쓰던 때부터 듣기, 재생 중 아직 안 쓴 필기는 흐리게·쪽 따라가기. 빌드 45: **사진·스티커·붙여넣기**: 도구 모음 '사진·스티커 넣기'로 갤러리 사진·복사한 사진·도장(중요·암기 …)·그림 스티커(별·체크 …), 올가미로 옮기고 크게·작게, PDF 내보내기·동기화까지. 빌드 44: **목록 화면을 디렉터리처럼**: 왼쪽 폴더 나무(폴더 안의 폴더, 접고 펴기)·위 경로(폴더 › 공부 › NCS)·폴더와 노트를 네모 칸 바둑판으로, 폴더 이름 바꾸기·안에 새 폴더. 빌드 43: 도구 모음 접기 단추(≪): 지금 도구와 펼치기(≫)만 남김. 빌드 42: **도구 모음 편집**: 끝의 ≡ 단추로 순서·숨기기·자리(위·왼쪽·오른쪽·떠 있게), 손잡이로 끌어 붙이기·띄우기. 색·굵기 단추에도 이름표, 펜 이름표 자리 고침, 따로 있던 '도구 설정' 단추는 뺌. 빌드 41: 도구 모음 그림 단추 이름표를 다시 만듦: 빌드 40의 안드로이드 기본 툴팁은 갤럭시탭에서 S펜을 띄워도·길게 눌러도 안 떴음. 빌드 39: 형광펜 직선: 처음 찍은 점에 고정해 그 높이 그대로 곧게(흔들려도, 기울게 끝나도), 좌우 넘기기는 화면 폭 1/5 넘게 끌면 속도와 상관없이 넘어감. 빌드 38: **쪽 보기 방식**: ⋯ 메뉴에서 좌우로 넘기기(손을 떼면 한 쪽씩 딱 맞춤)·위아래로 이어서·두 쪽씩 보기, 형광펜 직선이 긋는 동안에도 곧게 보임. 빌드 37: 빠르게 튕길 때 끊김: 빌드 36 패치가 관성 스크롤을 한 프레임 건너 그리게 만들어(60fps) 이번 프레임 끝에 바로 그리도록 고침. 빌드 36: RN Skia가 손가락 이벤트마다 즉시 그려 한 프레임에 두 번 그리다 막히던 것을 patch-package로 고침. 빌드 35: 쪽 캔버스를 SurfaceView(`opaque`)로. 빌드 34: 큰 PDF(수백 MB) 가져오기 OOM 고침, 목록에서 뒤로 두 번 눌러야 종료, 필기 화면 도구 모음을 한 줄 아이콘으로. 빌드 32: **AI 정리 노트**: 표시한 쪽의 교재 글로 개념·구조 표·명령어·예시 문제·시험 포인트까지 정리한 새 노트, 갤럭시탭+PC 서버(Gemini)로 실제 확인. 빌드 31: AI 설명을 Gemini로도: 서버가 Claude·Gemini 중 고름, 앱이 USB로 PC 서버(localhost http)에 붙을 수 있게. 빌드 30: 나만의 노트의 **AI 설명(프리미엄)**: Claude가 설명·표·막대그래프·순서 그림, 계정 요금제 무료·프리미엄. 빌드 29: 나만의 노트 글 겹침 고침: 글상자 높이를 기기에서 재어 배치, 갤럭시탭에서 확인. 미리 보기의 손글씨 그림이 안 보이던 것 고침. 빌드 27: 안드로이드 아래 시스템 막대 숨기기. 빌드 26: 바로 요약을 다듬어 새 노트로 만드는 **나만의 노트**. 빌드 25: 모던 미니멀 디자인, S펜 단추 두 번으로 도구 바꾸기, 스크롤 관성·움직일 때 쪽 사진)
> 이 문서만 읽으면 VS Code에서 바로 이어서 작업할 수 있도록 썼습니다. 기능 설명서는 [README.md](README.md)(PC·서버)와 [mobile/README.md](mobile/README.md)(앱)에 있습니다.

---

## 0. 한눈에 보기

| 항목 | 지금 상태 |
|---|---|
| 무엇 | PDF·종이책 스캔본에 **내가 표시한 부분(형광펜·밑줄·동그라미·손글씨)만 뽑아 요약**해 주는 프로그램 + 그 위에서 쓰는 **필기 앱** |
| 구성 | ① 파이썬 프로그램(`pdfsummary/`): 명령줄 · 끌어다 놓기 실행 화면 · 설치 앱(Windows/Mac) · **앱용 서버**(요약·동기화·계정) ② 필기 앱(`mobile/`, Expo): 아이패드·갤럭시탭·폰·웹 |
| 브랜치 | 모든 작업은 `claude/eager-galileo-06vzez`에만 있음. **main에 합치지 않았고 PR도 없음** |
| 자동 점검(CI) | 마지막 커밋 기준 **모두 통과**: 파이썬 시험, 앱 타입 검사·단위 시험(159개), 웹 e2e 2종, 안드로이드 APK 빌드, 에뮬레이터 실행 시험, iOS 빌드 |
| 설치 파일 | 갤럭시탭용 APK (빌드 51): **https://github.com/supergangy/pdfsummary/releases/latest/download/pdfsummary.apk** (항상 최신, 로그인 없이) |
| 실제 기기 | 갤럭시탭 SM-X820(안드로이드 17)에서 확인 중 (2026-11-21, 무선 디버깅). 필기 사라짐·S펜 단추 지우개는 **빌드 19에서 고쳐진 것 확인**. 빌드 20·21에서 고친 것(손글씨 받침, 도구 설정 창 자리, 요약 글자, 에이전트 시험에서 나온 27가지)은 **웹판에서만 확인했고 실기기 확인은 아직** → §6 P0 표, §7 점검표 |
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
npm test             # 단위 시험 (Node 내장 시험기, 96개)
```

`npm test`의 서버 대화 시험은 파이썬 서버를 띄우므로 **저장소 루트에서 `pip install -e .`가 되어 있어야** 합니다.

> **Windows에서**: 시험과 e2e는 `python3` 명령을 부르는데 Windows에는 보통 없습니다(스토어 연결만 있음). 가상환경의 `Scripts\python.exe`를 `python3.exe`로 하나 복사해 두고, 그 `Scripts` 폴더를 PATH 맨 앞에 두세요. 한글이 깨지지 않게 `PYTHONUTF8=1`도 필요합니다. 이렇게 하면 단위 시험 96개·웹 e2e 2종·`pytest`가 Windows에서도 모두 돕니다 (2026-11-21 확인).

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
| `accounts.py` | 계정·세션·가입 확인/비밀번호 찾기 메일 코드·Google 계정 잇기, **요금제(무료·프리미엄)와 달마다 AI 기능 횟수**(`use_ai`·`refund_ai`, `PDFSUMMARY_AI_LIMITS`), 관리자 명령(`python -m pdfsummary.accounts list·plan·reset-password·test-mail`) |
| `studynote.py` | **AI 정리 노트**: 표시한 쪽의 교재 글+표시 → 섹션마다 개념/구조(소제목·표·목록·순서·명령어·핵심 메모)/예시 문제와 답/시험 포인트(중요도 별)/고득점 전략. 쪽이 많으면 묶음(14,000자·8쪽)마다 따로 묻고 이어 붙임. `POST /api/ai/studynote`(한 번이 횟수 하나) |
| `gemini.py` | AI 설명을 **Gemini**로 (urllib만, `x-goog-api-key`, `responseJsonSchema` → 400이면 JSON 모드로 다시). 키는 `GEMINI_API_KEY` 또는 `~/.pdfsummary/gemini_key.txt`. 어느 AI를 쓸지는 `app.py`의 `ai_reader`·`explain_available` (`PDFSUMMARY_AI_BACKEND`) |
| `explain.py` | 나만의 노트의 **AI 설명**: 칠한 항목 → Claude(구조화된 출력)가 설명 + 그림 하나(표·막대그래프·순서). 답 크기를 다듬어(`clean_answer`) 앱으로. 엔드포인트는 `app.py`의 `POST /api/ai/explain`(로그인·횟수 확인, 실패하면 횟수 돌려놓기)·`GET /api/account/ai` |
| `mailer.py` | SMTP 메일 (`PDFSUMMARY_SMTP_*`, 시험용 `PDFSUMMARY_MAIL_DIR`) |
| `google_auth.py` | Google ID 토큰 확인 (RS256 서명을 파이썬만으로, JWKS 기억) |
| `notes.py` · `device_ai.py` | 앱 노트 → 요약용 PDF, 기기 안 AI 일감 |

### 4-2. 앱 (`mobile/`)

| 파일 | 하는 일 |
|---|---|
| `src/ui.tsx` | **디자인 체계** (모던 미니멀): 색 토큰(밝게·어둡게), 글자 크기 `type`, 모서리 `radius`, 떠 있는 창 `floating`, 부품 `ScreenTitle`·`Card`·`Button`(primary/plain/dark/link)·`Chip`·`Segmented`. 화면 밝기 설정 `useThemeMode` (기본 밝게, `src/themePref.ts`에 저장) |
| `App.tsx` | 화면 전환 (목록 · 필기 · 바로 요약 · 서버 요약) |
| `src/notes/Editor.tsx` | 필기 화면: 도구 모음, 저장(700ms 뒤 자동), 지우개(획/영역), 올가미, 글상자, 형광펜 글줄 맞추기 |
| `src/notes/PageCanvas.tsx` | Skia 그림판 + 펜 입력(UI 스레드 워크릿), **S펜 단추** 처리. 여러 쪽을 한 문서로 늘어놓고 화면 근처 쪽만 그린다(`PageLayer`), 입력은 손이 닿은 쪽 id와 함께 넘긴다 |
| `src/notes/pageLayout.ts` | 쪽 보기 방식(좌우·위아래·두 쪽씩)의 쪽 자리 계산, 점이 든 쪽·가까운 묶음·좌우 넘기기 목표 (UI 스레드에서도 쓰는 worklet) |
| `src/notes/ToolPanel.tsx` | 도구 설정 창 (펜 종류·굵기·선 모양·색 / 형광펜 / 지우개 / 올가미) |
| `src/notes/geometry.ts` | 획 윤곽(펜 종류별), **`strokeDraw`(화면·PDF·요약이 모두 이걸로 그림)**, 영역 지우개 `eraseFrom`, 형광펜 `fitHighlight` |
| `src/notes/model.ts` | 노트·획 데이터 모양 (획에 `brush`·`dash`·`opacity`는 선택 칸 → 예전 노트와 호환) |
| `src/notes/history.ts` | 되돌리기 (add/remove/replace/**split**) |
| `src/notes/fileFs.ts` · `fs.ts` | **기기 파일 저장** (§5-1 교훈) |
| `src/notes/quick.ts` · `QuickScreen.tsx` | 바로 요약 (형광펜/밑줄/동그라미/손글씨/메모/표시, 손글씨 줄 나누기·받침 붙이기 `sameLine`, 문제·보기 번호에서 문장 끊기 `itemMarker`) |
| `src/notes/myNote.ts` · `MyNoteMaker.tsx` · `myNotePrefs.ts` | **나만의 노트**: 바로 요약 → 새 노트. `buildDraft`(쪽 순서로 묶기, 같은 문장의 같은 색은 한 항목, 40pt 안의 메모는 붙이기, 못 읽은 손글씨는 그림), `layoutNote`(A4 빈 쪽에 제목·색 뜻 풀이·쪽 묶음·용어 모음을 글상자와 형광펜 막대로, 넘치면 다음 쪽). 미리 보기 화면에서 빼기·차례·메모·색 뜻. 색 뜻은 `mynote.json`에 기억 |
| `src/notes/studyNote.ts` | AI 정리 노트를 A4 쪽에 그림: 섹션 제목·소개, 제목(1·2단계), 문단, 목록, 순서 그림, 표(`myNote.ts`의 `tableParts`: 칸 폭은 낱말이 안 끊기게, 긴 표는 쪽마다 머리 줄 다시), 명령어 회색 판, 핵심 메모 보라 판, 문제와 답, 시험 포인트 표(별 노란색). 표시한 곳과 관련된 블록은 왼쪽 여백에 그 표시 색 막대 |
| `src/notes/aiExplain.ts` | AI 설명 요청: 쓸 수 있는지(`aiAccess`: 서버 연결·로그인·서버 Claude 키·요금제) → `requestExplain`. 받은 답은 `myNote.ts`의 `applyExplains`가 항목에 붙이고, `explainBlock`(표 `tableBlock`·막대 `chartBlock`·순서 `stepsBlock`)이 글상자와 곧은 선으로 그린다 |
| `src/notes/textLayer.ts` | **안드로이드**: 글자 인식(OCR)이 준 자리에 PDF 글자 층의 글자를 입힘 (`repairWithTextLayer`, ①→0 같은 오독 바로잡기). `modules/pdf-pages/index.ts`의 `pageText`가 부름 |
| `src/notes/editor-logic.ts` · `app-nav.ts` · `objects-grid.ts` · `net-errors.ts` | 화면 없이 시험할 수 있게 뺀 작은 계산들: 쪽 바탕 그림 고르기·되돌린 쪽 찾기·버릴 획 / 뒤로 단추가 갈 곳·폴더 유지 / 쪽 모아보기 줄 계산 / 서버 시간 제한·오류 글 |
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

0. **디자인은 모던 미니멀** (사용자가 요즘IT 사이트·글 '모던 미니멀 스타일의 UI 가이드'를 기준으로 고름, 2026-11-22): 흰 바탕과 넉넉한 여백, 은근히 둥근 모서리(8·12·16·20), 크고 굵은 제목, **강조색(보라)은 화면마다 가장 중요한 단추 하나에만**, 고른 것은 검은 알약(어두운 모드는 흰 알약), 그림자는 떠 있는 창에만 아주 옅게, **단추·제목에 이모지 쓰지 않기**(‹ ⋯ ↶ ↷ ＋ − ✕ ⚙︎ 같은 기호만). 색은 꼭 `useTheme()` 토큰으로 (어두운 모드). 새 화면은 `src/ui.tsx` 부품부터 쓰기
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
| `exportPdf.ts` → `embedFont(…, { subset: false })` | '쓴 글자만 넣기'(subset)를 켜면 나눔고딕 글자 모양이 깨져 **내보낸 PDF에서 글상자 글이 대부분 안 보였음**. 대신 글상자가 있는 PDF는 0.7MB쯤 커짐. `exportPdf.test.ts`가 글자 모양을 지킴 |
| `Editor.tsx` 저장: 획이 끝나고 0.35초 뒤 + 앱이 뒤로 갈 때(AppState) 바로 | 0.7초였을 때는 그 사이 앱이 닫히면 마지막 획이 사라질 수 있었음. 더 줄이면 이어 쓰는 획마다 쪽 전체를 다시 적게 됨 |
| 쪽 바탕 그림은 **쪽 id**로 기억 (`Editor.tsx`의 `bg`, `editor-logic.ts`의 `pageBg`) | 쪽 번호로 기억하면 쪽을 끼우거나 지울 때 그림이 한 쪽씩 밀림 (빈 쪽에 교재 다음 쪽이 보였음) |
| `PageGrid.tsx`: `initialScrollIndex`를 쓰지 않고 `getItemLayout` + 열린 뒤 `scrollToOffset` | 여러 칸 목록은 '줄' 단위로 세는데 쪽 번호를 넘겨서, 9쪽 뒤에서 열면 마지막 줄만 보이고 위로 못 올라갔음 |
| `PageCanvas.tsx`: 필기가 `HEAVY_STROKES`(80)개 넘는 쪽은 **움직이는 동안(끌기·확대·관성) 쪽 사진**(바탕 그림+속지+필기를 한 장으로, 가로 2048px까지)을 그리고 멈추면 원본 | 사용자가 삼성 노트처럼 해 달라고 함. 갤럭시탭에서 재 보니 Skia가 한 장면에 두 번 그리고(입력 단계·애니메이션 단계), 획 300개 쪽에서 메인 스레드가 장면당 5ms쯤 씀(120Hz 한도 8.3ms). 사진은 UI 스레드에서 GPU로 만든다(`OpenGLContext`가 스레드마다 하나라 화면과 같은 문맥). 획 300개 쪽에서 사진 만들기가 **33ms** 걸려(빌드 22, 끌기 시작 순간 멈칫함) 빌드 23부터는 내용이 바뀌고 0.7초 쉬면 미리 만든다(`requestSnap`, 움직이거나 쓰는 중이면 미룸). 사진이 아직 없으면 원본으로 그린다. 그래도 첫 끌기에 30ms가 남았던 것은, 화면 밖 그림판의 사진이 GPU 복사로 만들어지고 그 복사가 다음 flush로 미뤄졌기 때문 → **사진을 찍은 뒤에 flush** (빌드 24, 갤럭시탭에서 가장 긴 장면 틈 37→11ms 확인) 원본은 지우지 않고 빈 영역으로 잘라(`clip`) 건너뛴다. 사진은 두 세대 지난 것만 `dispose`(그리는 중인 것을 놓으면 앱이 멈출 수 있음). **빈 `SkPicture`를 공유 값으로 넘기면 네이티브가 예외** — 사진(SkImage)은 null이면 건너뜀. 웹은 화면 밖 그림판마다 WebGL 문맥이 따로 생겨 CPU(`Surface.Make`)로 |
| `PageCanvas.tsx`: 손가락으로 옮기다 떼면 `withDecay`로 미끄러짐 (감속 0.997, 속도 ±6000 한도). 마지막으로 움직인 지 0.12초 넘게 멈췄다 떼면 안 미끄러짐 | 끌기가 뚝 멈춰 '부드럽지 않다'고 느낌. 웹은 멈춰도 직전 속도가 남아 있어서 시간으로 막는다 |
| `PageCanvas.tsx` `onLayout`: `fit(w, h)`로 크기를 직접 넘김 | Reanimated 공유 값은 JS에서 쓰자마자 읽으면 예전 값(처음엔 0)이 나와, 새 노트가 '맞춤' 크기가 아니라 작게(배율 1) 열리곤 했다 |
| 도구 설정 창·⋯ 메뉴·바로 요약 화면: 막 열렸을 때(0.4초)의 누름은 넘김 | 단추를 빠르게 두 번 누르면 둘째 누름이 새로 뜬 화면의 다른 것을 눌렀음 (창이 바로 닫힘, 종이에 점, 서버 화면으로 넘어감) |
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
| 3 | **바로 요약의 형광펜 글자**: 빌드 19에서 칠한 글자는 맞게 나왔지만 "사용자 가"·"자 원"·"하드웨 어"처럼 떨어지고, "1."이 빠지고 "2."가 딸려 오고, ①②③④가 "0"·"3"으로 읽혔음 → **빌드 21에서 고침**: 경계 띄어쓰기는 원문대로, 줄 첫머리 번호에서 문장 끊기, 글자는 PDF 글자 층 것으로 바로잡기. **실기기 확인 필요** — 특히 마지막 것은 '안드로이드는 글자 있는 PDF도 글자 인식(OCR)으로만 읽는다'는 **추정**(코드·안드로이드 공개 소스)에 기대고 있음. `adb logcat -d -s PdfPages`에 `text layer: contents=… boxes=… chars=…`, `ocr: blocks=… lines=…`가 찍히니(글자 내용은 안 찍음) boxes가 0인지 보면 됨. **스캔본은 글자 층이 없어 그대로임** (①②③④ 오독, 낱말 가운데 띄어쓰기) | `src/notes/textLayer.ts`, `modules/pdf-pages/index.ts`의 `pageText`, `PageText.kt`의 `plain`, `OcrText.kt`(낱말 사이에 무조건 띄어쓰기, 낱말 상자를 글자 수로 나눔), `quick.ts`의 `sentenceAround`·`itemMarker` |
| 4 | **손글씨 인식**: "안녕"이 "아녀" + "U" 두 줄로 읽힘 → 받침이 아랫줄로 떨어져 나가던 것을 고침(`sameLine`, 쓴 차례가 두 줄을 오가면 한 줄). **실기기 확인 필요** (빌드 20부터) | `quick.ts`의 `splitInkLines`·`sameLine`, `InkRecognizerModule.kt`의 `WritingArea` |
| 5 | 펜 반응 속도·필압·손바닥 무시, 펜 종류별 느낌 | `PageCanvas.tsx`, `geometry.ts`의 `penOutline` |
| 6 | 큰 PDF(수백 쪽)에서 속도·메모리, 한글 PDF가 PdfRenderer에서 제대로 그려지는지 | `modules/pdf-pages`, `Editor.tsx`의 쪽 그림 미리 불러오기 |
| 7 | **도구 설정 창**이 도구 모음을 가리고, 도구 단추를 빠르게 두 번 누르면 떴다가 바로 닫힘 → 도구 모음 바로 밑·누른 단추 왼쪽 끝에 맞춰 뜨고, 막 열렸을 때의 바깥 누름은 넘기게 고침. 웹판에서 확인, **실기기 확인 필요** (빌드 20부터) | `ToolPanel.tsx`의 `at`·`closeOutside`, `Editor.tsx`의 `openPanel` |
| 8 | **손가락 동작** (빌드 21, 웹판 터치 흉내로만 확인): '손가락: 쓰기'에서 두 손가락으로 벌릴 때 쪽에 점이 안 찍히는지 / 쪽 바깥 회색 여백에서는 안 써지는지 / 손가락 하나로 쓰는 것과 S펜 필기는 전과 같은지 | `PageCanvas.tsx`의 한 손가락 동작 `onBegin`·`onUpdate`·`onFinalize` (UI 스레드 워크릿이라 단위 시험이 없음) |
| 9 | **뒤로 단추·저장** (빌드 21, 실기기에서만 확인 가능): 필기 화면에서 뒤로 → 앱 밖이 아니라 노트 목록으로 / 요약 화면에서 뒤로 → 보던 쪽으로 / 쓰자마자 홈 단추를 누르고 앱을 밀어 꺼도 마지막 획이 남는지 | `Editor.tsx`의 `onBack`·AppState, `App.tsx`의 BackHandler, `app-nav.ts` |
| 10 | **'붓' 모양** (빌드 21): 점·짧은 획이 보이게 고치면서 짧은 획은 둥근 점·막대로, 중간 길이 획은 조금 도톰하게 바뀜 → 느낌이 괜찮은지 눈으로 | `geometry.ts`의 `penOutline` |
| 11 | **쪽·글상자·내보내기** (빌드 21, 웹판에서 확인): PDF 노트에 빈 쪽 끼우기 / 쪽 모아보기를 10쪽 뒤에서 열기 / 글상자가 든 노트를 PDF로 내보내 다른 앱에서 열기(글이 다 보이는지, 느리지 않은지) / 기기 '글자 크기'를 크게 해 둔 채 글상자 한 줄이 줄바꿈되지 않는지 | `Editor.tsx`, `PageGrid.tsx`, `exportPdf.ts`, `model.ts`의 `makeTextBox` |
| 13 | **스크롤** (빌드 22, 웹판 터치 흉내로 확인): 손가락으로 밀고 떼면 미끄러지는지(너무 미끄럽거나 덜 미끄럽지 않은지), 필기 많은 쪽에서 움직이는 동안 잠깐 흐렸다가 멈추면 선명해지는지, 확대·축소 중에도 끊기지 않는지. 실기기 기록(`adb shell atrace -t 4 gfx view input sched`)으로 빌드 21과 견주기: 빌드 21은 획 300개 쪽에서 Choreographer#doFrame 중앙 4.1ms·최대 11.2ms | `PageCanvas.tsx`의 `makeSnap`·`startFling`·`moving` |
| 15 | ✅ **S펜 단추 두 번 → 등록한 도구** (빌드 24, 사용자가 갤럭시탭에서 '잘 된다'고 확인, 에어 커맨드와 안 부딪힘). 바꿀 도구는 펜 설정 창 맨 아래 (형광펜·지우개·올가미·즐겨찾는 펜·끄기) | `editor-logic.ts`의 `penDoubleClick`·`penSwap`, `StylusModule.kt`(hover) |
| 17 | **나만의 노트** (빌드 26, 웹판 e2e와 화면 캡처로 확인): 실제 교재로 바로 요약 → '나만의 노트' → 쪽 순서·색 뜻 꼬리표·붙은 메모가 맞는지, 만든 노트에서 글이 상자 밖으로 넘치거나 겹치지 않는지 — **빌드 27에서 띄어쓰기 없는 긴 제목이 3줄로 바뀌며 아래 줄과 겹쳤음**(갤럭시탭은 낱말 단위로 줄을 바꾸고 줄 길이를 고르게 맞춤) → 빌드 28부터 '노트로 만들기' 직전에 글상자들을 안 보이게 그려 실제 높이를 재고(`boxesToMeasure`·`HeightOf`) 그 높이로 배치. 칠하기가 낱말 가운데서 시작·끝나면 낱말 끝까지 넓힘(`wholeWords`, 조사는 안 붙임), 기호뿐인 손글씨 인식("~")은 그림으로, 만든 노트를 이어서 쓰고 PDF로 내보내기 | `myNote.ts`의 `layoutNote`·`textBox`, `model.ts`의 `textBoxHeight`·`textLineWidth` |
| 20 | **큰 PDF 가져오기** (빌드 34): 714MB 스캔 PDF('정보기 실기 1 2-upscaled(OCR).pdf')가 "PDF를 열 수 없어요"로 실패 → 동기화가 켜져 있으면 저장할 때 PDF 내용 해시를 JS로 통째 읽어(`FileSystemFile.bytes`) OutOfMemory. 기기에서는 네이티브 `shaAsync`(1MB씩 읽기)로 계산, 200MB 넘는 PDF는 동기화에 올리지 않음(필기만 맞춤). 72MB·150쪽은 빌드 32에서도 10초 안에 됐음. **확인**: 그 714MB 파일 가져오기·쪽 넘기기·요약, 다른 기기 동기화 때 'PDF 없음' 안내 | `modules/pdf-pages`의 `shaAsync`, `syncedStore.ts`의 `pdfShaOf`·`PDF_SYNC_MAX` |
| 21 | **뒤로 단추·한 줄 도구 모음** (빌드 34): 목록에서 뒤로 → "한 번 더 누르면 앱을 나가요" 뒤 2초 안 재누름에 종료. 필기 화면 윗줄 둘을 한 줄로(아이콘, 노트 이름은 ⋯ 메뉴 '이름 바꾸기'). 확인: 아이콘이 알아볼 만한지, 좁은 폰에서 옆으로 밀리는지, 도구 설정 창이 아이콘 밑에 뜨는지 | `App.tsx`, `app-nav.ts`의 `exitOnSecondBack`, `Editor.tsx`, `ToolIcon*.tsx` |
| 22 | **스크롤 부드럽게** (빌드 35): 삼성노트보다 프레임이 떨어져 보임 → 측정해 보니 화면은 120Hz로 돌고 Skia도 8.3ms마다 그리는데, 쪽 캔버스가 TextureView라 창 합성(RenderThread)이 16.6ms마다 = 실제로는 60fps만 보였음. `PageCanvas`의 `<Canvas opaque>`로 SurfaceView를 쓰게 해 Skia 그림이 창을 거치지 않고 바로 화면에. 바탕색은 `<Fill>`로 Skia가 칠함. **갤럭시탭에서 확인함 (빌드 35)**: 화면 합성기가 쪽을 내보낸 간격 16.6ms → 8.3ms (60 → 120fps), 펜 설정 창·⋯ 메뉴·쪽 모아보기가 캔버스 위에 잘 뜨고 손가락 필기도 그려짐. **남은 확인**: 사람 손으로 스크롤해 체감, 글상자 입력·올가미 메뉴, 다크 모드 바탕색 | `PageCanvas.tsx`, 재는 법은 `atrace`로 `queueBuffer`(Skia) vs `DrawFrames`(창) 간격 비교 |
| 23 | **스크롤 60Hz 느낌** (빌드 36): 빌드 35 뒤에도 "60Hz 같다" → 추적해 보니 RN Skia가 메인 스레드에서 다시 그리기 요청을 받으면 **바로** 그림(`PlatformContext.notifyTaskReady`). 손가락 이벤트 처리 중에 한 번, Reanimated 프레임에서 또 한 번 그려 두 번째가 화면 버퍼를 기다리며 ~7ms 막힘 → 메인 스레드 프레임 4개 중 1개가 8.3ms를 넘어 건너뜀. `mobile/patches/@shopify+react-native-skia+2.14.0.patch`로 그 일을 **이번 프레임이 끝난 직후 한 번**(비동기 메시지) 하게, 6ms 안에 이미 그렸으면 다음 vsync로. (빌드 36은 늘 다음 vsync로 미뤘더니 Reanimated 관성 스크롤이 한 프레임 걸러 그려져 60fps가 됐음 → 빌드 37에서 고침.) `postinstall`의 `patch-package`가 적용. **RN Skia를 올리면 이 패치가 아직 필요한지 보고 다시 만들 것.** 확인: 사람 손으로 스크롤했을 때 삼성노트만큼 부드러운지 | `patches/`, 재는 법은 `scratchpad`의 atrace 분석(doFrame 길이, 한 프레임 안 eglSwapBuffers 수) |
| 24 | **쪽 보기 방식·직선 미리 보기** (빌드 38, 웹판 e2e로 확인): ⋯ 메뉴 '좌우로 넘기기 (한 쪽씩)' / '위아래로 넘기기 (이어서)' / '두 쪽씩 보기'(설정 `flow`·`twoPages`로 기억). 좌우는 맞춤 배율에서 처음 민 방향으로 묶어 가로면 손을 뗄 때 다음·이전 쪽에 딱 맞추고(`pageTurnTarget`, 빠르게 밀면 한 쪽), 세로면 그 쪽 안에서만. 확대한 채면 자유롭게 움직이고 놓으면 가까운 쪽 안으로. 위아래는 이어 붙여 관성 스크롤, 가운데 쪽이 바뀌면 도구 모음 쪽 번호가 따라감(`onShown`). 펜·지우개·올가미·글상자는 손이 닿은 쪽에 들어가고 그 쪽이 '지금 쪽'이 됨(`activate`). 올가미로 고른 것은 고른 쪽에 남음(`Selection.page`). 형광펜 직선은 `straighten`을 worklet으로 해서 긋는 동안에도 곧게. 빌드 39부터 직선은 **처음 찍은 점에 고정**(가로로 더 갔으면 처음 높이의 수평선, 세로로 더 갔으면 수직선; 예전엔 점들의 평균 높이였고 기울면 펴지 않았음 — 사용자 요청). 좌우 넘기기는 끈 거리가 화면 폭 1/5을 넘어도 넘어감(빌드 38 갤럭시탭에서 adb로 휙 밀었는데 속도가 0으로 재져 제자리에 선 적이 있음). **갤럭시탭 확인(빌드 38)**: 좌우 넘기기 휙 밀기·되돌아 밀기·천천히 조금 끌기(제자리)·세로로 밀기(쪽 그대로)에서 쪽 폭이 맞춤 그대로, 위아래 보기에서 밀면 쪽 번호가 따라감. **남은 확인**: 두 쪽 보기·직선 미리 보기를 기기에서, 세 방식 모두 손가락 스크롤·관성·쪽 넘김이 부드러운지, 필기 많은 쪽이 여러 개 보일 때 움직이는 동안 쪽 사진이 잘 쓰이는지, 두 쪽 보기에서 펜이 오른쪽 쪽에 정확히 찍히는지, 쪽 끼우기·지우기 뒤 화면이 그 쪽에 머무는지 | `PageCanvas.tsx`, `pageLayout.ts`, `Editor.tsx`의 `showPage`·`activate`·`onShown` |
| 25 | **단추 이름표** (빌드 41): 빌드 40은 안드로이드 기본 툴팁(`View.tooltipText` 감싸개)이었는데 갤럭시탭에서 **S펜을 띄워도, 길게 눌러도 안 떴다** (길게 누르기는 안쪽 RN 단추가 터치를 다 가져가 감싸개까지 안 옴, 펜 띄우기는 adb로 흉내 낼 수 없어 원인 못 봄). 빌드 41: 도구 모음을 `StylusView`(`hoverEvents`)로 감싸 펜이 떠 있는 자리(dp)를 `onHover`로 받고, `Editor.tsx`가 등록된 그림 단추(`useTip`) 자리를 재서 그 밑에 이름표를 직접 그린다(0.35초 뒤, 옆 단추로 옮기면 바로). 손가락으로 길게 누르면 1.5초. 쪽 화면의 S펜 두 번 누르기가 같은 떠 있기 이벤트로 이미 잘 되므로 이 길을 씀. 웹은 마우스를 띄우면 같은 이름표(e2e로 확인). **확인**: 갤럭시탭에서 S펜을 단추 위에 띄우면 이름이 뜨는지 | `modules/stylus`의 `onHover`, `Editor.tsx`의 `useTip`·`onBarHover`·`tool-tip` |
| 26 | **도구 모음 편집·옮기기** (빌드 42, 웹판 e2e로 확인): 도구 모음 맨 끝 '도구 모음 편집'(≡) → 자리(위·왼쪽·오른쪽·떠 있게), 항목 순서(▲▼), 보이기(스위치), 처음대로. 끝의 '도구 모음 접기'(≪)는 지금 도구 하나와 '펼치기'(≫)만 남긴다(설정 `toolbarMin`, 빌드 43). 도구 모음 앞의 손잡이(⋮⋮)를 끌어 화면 위 줄 근처·왼쪽 끝·오른쪽 끝에 놓으면 그쪽에 붙고 가운데면 그 자리에 떠 있음(`dockAt`, 끄는 동안은 '여기에 놓기' 표시만 따라감 — 손잡이가 다른 자리로 옮겨지면 끌기가 끊기므로). 설정 `toolbar`·`toolbarHidden`·`toolbarDock`·`toolbarFloat`. 왼쪽·오른쪽에 붙이면 이름표는 단추 옆에, 도구 설정 창도 도구 모음 옆에. 따로 있던 '도구 설정' 단추는 사용자 요청으로 뺌(고른 도구를 한 번 더 누르면 같은 창). 이름표: 색 단추는 색 이름(`colorName`), 굵기는 '굵기: 가늘게/보통/굵게', 말풍선은 제 폭을 재서 단추 가운데에(예전엔 폭 200 상자를 화면 안으로 당겨 왼쪽 끝 펜 단추 이름표가 오른쪽으로 밀렸음). S펜 떠 있는 자리는 이제 창 기준으로 받음(여러 곳의 도구 모음 공통). **확인**: 갤럭시탭에서 세로 도구 모음(왼쪽·오른쪽)이 잘 보이고 밀리는지, 손잡이 끌기, 떠 있는 도구 모음 위에서 필기 | `toolbar.ts`, `Editor.tsx`의 `item`·`strip`·`grip`·`ToolbarDialog`·`TipBubble` |
| 27 | **폴더를 디렉터리처럼** (빌드 44, 웹판 e2e로 확인): 사용자가 삼성노트 화면을 보여 주며 요청. 폴더는 '공부/NCS'처럼 `/`로 이은 경로 글자로 저장(폴더 목록·노트 `folder` 칸 그대로라 예전 폴더는 맨 위 폴더, 동기화도 그대로, 이름의 `/`는 `-`로). 목록 화면: 넓으면(840 이상) 왼쪽 폴더 나무(모든 노트 · 폴더(맨 위) · 나무, 노트 수는 바로 안의 것), 위에 경로 단추, 가운데 바둑판에 아래 폴더 칸 + 노트 칸(네모, 쪽 위쪽부터). '맨 위'는 폴더 밖 노트와 맨 위 폴더, '모든 노트'(`ALL_NOTES`)는 전부. 폴더 ⋯: 열기·안에 새 폴더·이름 바꾸기(아래 폴더·노트 경로도)·지우기(안의 폴더도 지우고 노트는 윗 폴더로). 좁은 폰은 나무 없이 폴더 칸·경로로. 계산은 `folders.ts`(시험 있음). **확인**: 갤럭시탭에서 폴더 나무·바둑판 모양, 다른 기기 동기화 뒤에도 폴더 경로가 맞는지 | `Library.tsx`, `folders.ts`, `app-nav.ts`의 `keepFolder` |
| 28 | **사진·스티커·붙여넣기** (빌드 45, 웹판 e2e로 확인): 획에 새 종류 `tool: "image"`(+`img` data URI, `pts`는 글상자처럼 상자)와 글상자의 `stamp`(도장) — 둘 다 선택 칸이라 예전 노트·예전 앱과 섞여도 됨(예전 앱은 `parseStrokes`에서 사진을 건너뜀). 사진은 긴 변 1600px로 줄여(JPEG 82, 투명 PNG는 PNG) 획에 그대로 담아 저장·동기화·.pnote·PDF가 따로 할 일 없이 됨. 동기화: 작업 하나 2.5MB·한 번 보내기 24MB로 나눠 보냄(`opBytes`·`pushBytes`, 서버 작업당 4MB·보내기 40MB 한도), 서버 받기도 16MB씩(`MAX_PULL_BYTES`). 그리기: 사진이 맨 밑(그 위에 칠하고 씀), 지우개는 사진을 안 지움(올가미로 골라 지우기). 넣으면 화면 가운데(`PageCanvas`의 `viewRef`)에 보이는 곳 절반 크기로, 바로 올가미로 골라 둠 → 끌기·'작게'·'크게'(`scaled`). 붙여넣기: 기기는 `expo-clipboard`(움직이는 GIF는 첫 장면만), 웹은 Ctrl+V. 사진 고르기 `expo-image-picker`. 그림 스티커는 `stickers.ts`의 SVG 경로를 Skia로 PNG로(`stickerPicture`). 요약 서버로는 사진을 보내지 않음(`payload.ts`). **확인**: 갤럭시탭에서 갤러리 사진(세로로 찍은 사진 방향), 다른 앱에서 복사한 사진 붙여넣기, 사진 여러 장 쪽의 스크롤·동기화 속도 | `insertImage.ts`, `stickers.ts`, `render.ts`의 `strokeImage`, `exportPdf.ts`의 `drawImageBox`·`drawStamp`, `Editor.tsx`의 `addObjects`·`placePicture`·`StickerSheet` |
| 29 | **강의 녹음** (빌드 46, 웹판 e2e(가짜 마이크)로 확인): 도구 모음 '강의 녹음'(마이크) → 녹음 중엔 빨간 '● 12:03'(누르면 멈추고 저장). 녹음 중에 쓴 획·글상자에 `rec`(녹음 id)·`rt`(ms) 선택 칸. 녹음 파일은 `expo-audio`(32kHz 모노 64kbps m4a, 한 시간 28MB쯤)로 노트 폴더 `rec/<id>/audio.<ext>`, 목록은 `recordings.json` — **이 기기에만**(동기화 안 함, 획의 시각은 동기화됨). 백그라운드 녹음 켬(app.json `expo-audio` `enableBackgroundRecording`, 안드로이드 알림 권한 물음). 노트를 닫으면 녹음을 먼저 저장. 재생 막대: 재생·−10/+10·위치 막대·빠르기(1~2배)·필기 눌러 듣기(펜이 쓰지 않고 누른 자리의 녹음 획을 찾아 그 시각 2초 전부터, `PageCanvas`의 `tapOnly`)·쪽 따라가기(`pageAt`)·녹음 목록(듣기·지우기). 재생 중엔 그 녹음에서 아직 안 쓴 획을 흐리게(`inkPicture`의 `fade`, 0.5초 단위). 계산은 `audioSync.ts`(시험 있음). **확인**: 갤럭시탭에서 화면이 꺼져도 녹음이 이어지는지, 긴 녹음(1시간) 저장·재생, 녹음 중 쪽 넘기며 쓰기 | `LectureAudio.tsx`, `audioSync.ts`, `store.ts`의 `addRecording`, `Editor.tsx` |
| 30 | **즐겨찾기·휴지통·꾹 눌러 끌기** (빌드 47, 웹판 e2e로 확인): 노트에 선택 칸 `fav`·`trashed`(넣은 때 ms)·`pos`(끌어 옮긴 자리) — 노트 정보(`NbMeta`)로 동기화, 바꿔도 고친 시각은 그대로(`store.patchMeta`). 목록 순서는 `pos ?? updated` 큰 것이 앞(`sortNotes`), 노트를 다른 노트 위에 놓으면 그 앞 자리 값(`posBefore`). 왼쪽: 모든 노트·즐겨찾기·폴더 나무·휴지통. 노트 칸 오른쪽 위 ☆/★로 즐겨찾기. '노트 지우기'는 휴지통으로(되살리기·영원히 지우기·비우기, `TRASH_DAYS`=30일 지나면 목록을 읽을 때 지움). 꾹 눌러 끌기: 노트·폴더 칸을 0.45초 누르면(`react-native-gesture-handler` 팬 `activateAfterLongPress`, 목록은 RNGH `ScrollView`) 끄는 표가 손가락을 따라가고, 폴더 칸·왼쪽 폴더(그 안에)·왼쪽 '폴더'(밖으로)·즐겨찾기·휴지통·노트 칸(그 앞으로)에 놓는다. 폴더도 끌어 다른 폴더 안으로(`relocateFolder`). 끌고 놓은 직후의 누름은 무시(`justDragged`, 웹에서 놓을 때 밑의 칸이 열렸음). 칸의 길게 누르기 메뉴는 끌기와 겹쳐서 뺌(⋯ 단추로). **확인**: 갤럭시탭에서 손가락으로 꾹 눌러 끌기(목록 스크롤과 안 섞이는지), 끄는 동안 화면 끝에서 자동 스크롤은 아직 없음 | `Library.tsx`의 `Draggable`·`useDrop`·`dropOn`, `folders.ts`의 `sortNotes`·`posBefore`·`trashExpired` |
| 31 | **도구 모음 자리·모양 다듬기, 이름 바꾸기, 마이크 권한** (빌드 48, 웹판 e2e로 확인): ① 빌드 47에서 '녹음하려면 마이크를 허락해 주세요'만 뜨고 허락 창이 안 떴음 → 갤럭시탭 `dumpsys package`에 RECORD_AUDIO가 없었음. `expo-image-picker` 플러그인의 `microphonePermission: false`가 권한을 지우고 있었다 → 뺌. 권한은 녹음 단추를 누를 때 묻고(사용자와 의논: 쓰는 순간에 묻는 것이 안드로이드 권장), 다시 물을 수 없으면 '설정 열기' 창. ② 왼쪽·오른쪽·떠 있게면 윗줄을 없애고 돌아가기(맨 위)·쪽 번호·⋯·요약(맨 아래)을 도구 모음 안에. ③ 도구 모음 아무 데나 0.45초 꾹 눌러 끌어 옮기기(RNGH `holdMove`), 손잡이도 RNGH 팬(`gripPan` — 바깥 꾹 누르기 제스처 안에서 PanResponder가 안 먹었음). ④ 떠 있는 모양 `toolbarShape`: 한 줄·두 줄(보이는 항목을 반씩)·세로. ⑤ 목록: 노트·폴더 이름을 누르면 이름 바꾸기(굿노트처럼), 칸을 꾹 눌렀다 움직이지 않고 떼면 ⋯ 메뉴(아이패드 파일 앱처럼, 끌면 옮기기). 노트 ⋯에 '이름 바꾸기'. ⑥ 즐겨찾기 별: 38px 흰 동그라미 + 테두리(즐겨찾기면 노란). **확인**: 갤럭시탭에서 녹음 단추 → 허락 창, 세로 도구 모음에서 도구 설정 창 자리 | `Editor.tsx`의 `tbDrag`·`holdMove`·`gripPan`·`sideStrip`·`pageNav`, `Library.tsx`, `app.json` |
| 32 | **앱 아이콘, 노트 서식, 지금 쪽 표시, 끌면 따라오는 도구 모음, 테마 설정** (빌드 49·50, 웹판 e2e로 확인): ① 아이콘: 복숭아색(#FFE9DE) 바탕에 기울인 종이 + 노란 파스텔 형광 마커(사용자가 고름, 나중에 다시 다듬기로 함). 후보는 Artifact 디자인 캔버스에 있고 그림 원본(SVG)은 그때 스크립트로 만들었음 — 다시 다듬을 때 새로 그려도 됨. 안드로이드 바탕색·시작 화면 바탕색도 같은 색. ② 즐겨찾기 별: 동그라미 테두리를 빼고 별만, 누르는 자리 38칸은 그대로. ③ 새 노트 '서식': 코넬 노트·할 일·월간 달력·주간 계획·오답 노트 (`Paper`에 값 추가). 무늬는 `paperTemplates.ts`의 `paperMarks`(선·네모·점·글 목록) 하나를 화면(Skia, 칸 이름은 나눔고딕을 `Skia.Typeface`로)·PDF 내보내기(칸 이름이 있으면 한글 글꼴을 넣음, `needsKoreanFont`)·목록 견본(View)이 함께 그린다. 새 노트 이름 칸의 '(예: 정보처리기사 오답)'은 뺌. ④ 쪽 구분: 쪽 테두리를 진하게 + 옅은 그림자, 밝은 모드 쪽 둘레 #E6E8EC. 움직이는 동안 오른쪽(가로 넘김이면 아래)에 위치 막대와 '3 / 12'(`PageCanvas`의 `ScrollSpot`, 멈추고 1초 뒤 사라짐). ⑤ 도구 모음을 끌면(손잡이·꾹 누르기) 도구 모음 자체가 손가락을 따라오고(원래 자리에 둔 채 transform으로 밀기 — 빼면 끌기가 끊김), 가장자리 가까이 가면 그쪽에 '붙이기' 띠. ⑥ 테마(밝게·어둡게·기기 설정 따르기)는 원래 있었지만 요약 화면 설정 안에 숨어 있었음 → 목록 화면 '설정'을 누르면 바로 고르는 창, 서버·API 키는 그 안의 단추로. **확인**: 갤럭시탭에서 새 아이콘, 손가락으로 쪽 넘길 때 '3 / 12'와 막대, 도구 모음 끌기(SurfaceView 위로 보이는지) | `paperTemplates.ts`, `render.ts`의 `paperPicture`·`usePaperFont`, `exportPdf.ts`의 `drawPaper`, `PageCanvas.tsx`의 `ScrollSpot`, `Editor.tsx`의 `tbDrag`·`liftStyle`, `Library.tsx`의 `SettingsDialog`·`TemplateThumb` |
| 33 | **실제 교재로 요약 시험 (2026-11-24, PC에서)**: 사용자의 92쪽짜리 정리 PDF(글자층 있음, 저장소에 넣지 않음) 6쪽에 형광펜 12줄을 앱과 같은 길(`build_note_pdf` + `--no-drawings --scan off`)로 쳐서 요약 → 12줄 모두 찾고 모두 요약에 들어감(3.5초). AI 설명(Gemini)도 12개 모두 답(8초, 필요한 곳엔 비교표). **고친 것**: 앱 노트가 아닌 길('PDF만 넣어 요약하기', 명령줄)에서는 꾸민 PDF의 갈색 글머리 점(•, 4pt 채운 동그라미) 120개가 모두 '손글씨'로 잡혔다 → `strokes.py`에서 아주 작고 동그스름한 불투명 채우기는 뺌 (`test_bullet_dots_are_not_handwriting`) | `pdfsummary/strokes.py`의 `strokes_from_drawings` |
| 34 | **갤럭시탭에서 빌드 50 확인 (2026-11-24)**: 새 아이콘(홈 화면), 테두리 뺀 별, 설정 창의 테마(밝게↔어둡게 바로 바뀜), 새 노트 서식 5가지·월간 달력의 한글 요일(Skia), 도구 모음을 끄는 동안 손가락을 따라옴(SurfaceView 위로 보임), 쪽 둘레 구분 — 모두 실기기 화면으로 확인. **고친 것**: 움직일 때 나오는 '지금 쪽' 표시가 두 쪽 보기에서 '1 / 92'에 멈춰 있었다(도구 모음은 7 / 92). 화면 가운데 점이 든 쪽으로 셌는데 두 쪽 보기에서는 가운데가 두 쪽 사이 틈 → 도구 모음과 같이 '가장 가까운 묶음'으로 세고, 두 쪽이면 '7–8 / 92'로 (`spotLabel`, 단위 시험 + e2e). **바꾼 것**: 도구 모음 손잡이(점 6개)를 맨 끝으로 — 가로면 요약 단추 오른쪽, 세로면 맨 아래 (사용자 요청, e2e `gripEnd`) | `pageLayout.ts`의 `spotLabel`, `PageCanvas.tsx`의 `spotSpread`, `Editor.tsx`의 `gripView` 자리 |
| 35 | **도구 모음 다듬기 · 쪽 이동 막대 · 마지막 쪽 기억 · 기기 요약 문장 (2026-11-24, 사용자 요청)**: ① 손잡이(⋮⋮)와 요약 단추 사이를 띄움 (가로 14, 세로 10). ② '떠 있게' → '플로팅' (자리 이름·모양·안내 글). ③ 도구 모음 편집의 순서: ▲▼ 단추를 빼고 줄을 꾹 눌러(0.3초) 끌어 옮기기 (`OrderRow`, `moveTo`; 화면 읽기 프로그램은 '앞으로'·'뒤로' 동작). ④ 쪽 화면 아래 가운데에 쪽 이동 막대 (`PageScrubber`): 누르거나 끌면 그 쪽으로, 끄는 동안 'N / 전체'. 올가미로 고른 것·녹음 재생 막대가 있으면 숨김. ⑤ 노트마다 마지막에 보던 쪽을 기억 (`lastPage.ts`, 기기의 `lastPages.json`. 노트 파일에 넣지 않은 까닭: 쪽을 넘길 때마다 '고친 노트'가 되어 목록 순서·동기화가 흔들림). 요약에서 돌아올 때는 요약에서 보던 쪽이 먼저 (`openingPage`). ⑥ 갤럭시탭에서 92쪽 정리 PDF에 펜 밑줄 4개를 쳐서 기기 요약 → 4개 모두 찾고 밑줄 친 글자도 정확했지만, 앞뒤 문장에 옆 표 칸·코드 상자 글이 뒤섞여 붙었다 (태블릿 글자 상자는 글자 인식 덩어리 차례). `quick.ts`의 `sentenceAround`가 쪽 위 자리로 떨어진 곳(글자 크기가 다른 제목, 바로 밑 줄이 아닌 곳, 옆 칸)에서 끊게 함 (`apart`). 시험 뒤 밑줄은 되돌리기로 지움 | `Editor.tsx`의 `ToolbarDialog`·`OrderRow`·`gripView`, `PageScrubber.tsx`, `lastPage.ts`, `editor-logic.ts`의 `scrubIndex`·`rememberPage`·`openingPage`, `toolbar.ts`의 `moveTo`, `quick.ts`의 `apart` |
| 19 | ✅ **AI 설명·AI 정리 노트** (빌드 31·32, 2026-11-23 갤럭시탭 + PC 서버(USB `adb reverse`, Gemini)로 실제 확인): 칠한 곳마다 설명(스택·큐 비교표), 시험지 1쪽 정리 노트 약 30초(개념·비교표·목록·주의 상자·문제와 답·시험 포인트, 겹침 없음). 남은 것: 서버 배포 후 https로, Claude로도, 교재가 길 때(수십 쪽) 시간·묶음 이어 붙이기 | `studynote.py`, `studyNote.ts`, `gemini.py`(붐비면 다음 모델) |
| 18 | **아래 시스템 막대 숨기기** (빌드 27): 갤럭시탭 제스처 줄 자리에 회색 띠가 쪽 아래를 가렸음 → 앱 안에서는 숨기고(`expo-navigation-bar`, `App.tsx`의 `<NavigationBar hidden>`), 아래 끝에서 위로 쓸면 잠깐 나타났다 다시 숨음. 나타날 때도 회색 바탕 없음(app.json `enforceContrast: false`). 확인: 쪽 아래가 끝까지 보이는지, 홈으로 나가기(위로 두 번 쓸기)가 불편하지 않은지, 파일 고르기·공유 창에서 돌아와도 숨어 있는지, 3단추 내비게이션에서도 괜찮은지 | `App.tsx`, `app.json`의 `expo-navigation-bar` 플러그인 |
| 16 | **새 디자인** (빌드 25, 웹판에서 밝게·어둡게·태블릿·폰 모두 찍어 봄): 실기기에서 글자 크기·간격·단추 크기가 손에 맞는지, 어두운 모드, 설정의 '화면 밝기' | `src/ui.tsx`, 각 화면 |
| 14 | **되돌리기·다시 단추** (빌드 22): 윗줄 오른쪽에 '↶ 되돌리기', '↷ 다시' 글 단추로 보이는지(꺼져도 자리는 보임). 요약을 보고 돌아와도 되돌리기가 이어지는지 | `Editor.tsx`의 `HistBtn`·`keptHistory` |
| 12 | **서버 없이·서버가 대답 없을 때** (빌드 21, 웹판에서 확인): 12초쯤 뒤 한국어 안내가 뜨는지, 느린 와이파이로 큰 PDF를 올릴 때 중간에 잘못 끊기지 않는지 | `net-errors.ts`, `api.ts`, `platform/upload.ts`, `sync/transport.ts` |

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
8. **프리미엄(AI 기능) 결제·요금 정하기**: 요금제 틀(무료 한 달 3번·프리미엄 100번, `PDFSUMMARY_AI_LIMITS`)과 서버 쪽 횟수 세기는 됐지만 **결제 연동은 없음** — 지금은 서버 관리자가 `python -m pdfsummary.accounts plan 이메일 premium`으로 바꿈. 정할 것: 프리미엄 값, 결제 방법(안드로이드는 Play 결제 정책상 앱 안 디지털 상품은 Google Play 결제가 원칙), 요금제 이름·횟수. 비용 감: AI 설명 한 번(항목 20개쯤)이 Claude Opus 5.5로 대략 200~500원. **AI 설명을 실제로 쓰려면 서버 배포(위 1) + 서버의 `ANTHROPIC_API_KEY`가 먼저** (실기기에서는 아직 진짜 Claude로 시험하지 않음 — 웹판에서 가짜 AI 서버로만 화면 확인)
9. **개인정보 처리 안내·약관**: 스토어 심사와 계정 기능에 필요 (PDF를 사용자가 정한 서버로 보냄, 이메일 저장, Google 로그인).

### P2 — 기능 다듬기 (삼성노트·굿노트와 비교해 아직 없는 것)

- 형광펜 **펜촉 모양**(삼성노트의 T 아이콘 3개), **즐겨찾는 펜**(⭐), **사용자 색 고르기**(색상환), 필압 곡선 설정
- 웹판: 펜 단추를 **누른 채 떠 있다가 닿으면** 그리기 자체가 시작되지 않음 (브라우저가 '오른쪽 단추 누름'으로 보냄. 쓰다가 누르는 건 됨). 태블릿 앱은 해당 없음
- 웹판에는 **글자 인식(OCR)이 없음** → 웹에서 스캔본 PDF의 형광펜 글자는 못 뽑음 (pdf.js 글자 층만)
- 영역 지우개가 **글상자**에 닿으면 글상자 통째로 지워짐
- **예전 노트의 글상자**는 보이는 글보다 넓은 상자(폭 320)를 그대로 갖고 있어, 옆 필기를 지우다 같이 지워질 수 있음 (새로 만드는 글상자는 빌드 21부터 글에 맞는 폭). 판정 때만 '보이는 글 폭'을 쓰게 하려면 `geometry.ts`의 `hits`·`bounds`
- **스캔본** 요약의 글자 품질: 글자 인식만 쓰므로 ①②③④ 오독과 낱말 가운데 띄어쓰기가 남음. `OcrText.kt`에서 낱말 사이 틈이 좁으면 띄어쓰기를 안 넣는 것은 실기기에서 틈 크기를 재 본 뒤에 (문턱을 잘못 잡으면 낱말이 붙음). 두 단 편집에서 읽는 차례도 실기기 확인 필요
- 웹판에서는 필기 많은 쪽에서 터치 하나 처리가 20~40ms라 손을 뗄 때 속도가 0으로 잡혀 관성이 안 생김 (CanvasKit이 느림. 태블릿은 장면당 3~5ms)
- 키보드 단축키(Ctrl+Z·Ctrl+Y)는 **웹판만**. 갤럭시탭에 키보드를 달아도 앱판은 안 됨 (React Native에 전체 키 이벤트가 없어 MainActivity를 고치는 설정 플러그인이 필요)
- 삼성 노트처럼 **쪽을 위아래로 이어서 넘기는 스크롤**은 없음 (지금은 한 쪽씩, ◀ ▶). 하려면 PageCanvas를 쪽마다 두는 목록으로 바꾸는 큰 작업
- 웹판만: 영어·숫자·기호가 섞인 줄에서 형광펜 자리와 칠한 글자가 한두 글자 밀림 (pdf.js 글자 상자) / 같은 노트를 창 두 개에서 열면 한쪽 필기가 덮임 / 쓰고 0.35초 안에 새로 고치면 마지막 획이 빠짐 / 브라우저 '뒤로'가 노트 목록이 아니라 앞 사이트로 감
- 되돌리기가 다른 쪽의 필기를 건드릴 때 지금은 '그 쪽으로 넘기고 알려 주기'. 무엇이 사라질지 미리 보여 주려면(첫 누름은 쪽만 옮기기) `history.ts`를 고쳐야 함
- 노트를 다시 열 때 마지막에 보던 쪽에서 시작하기 (지금은 요약을 보고 돌아올 때만 보던 쪽)
- 바로 요약: 화살표·괄호·별표 같은 표시 종류, 표시별 중요도
- 아이패드 손글씨 인식은 획을 그림으로 그려 Vision에 넘기는 방식 — 정확도 미확인
- 기기 안 AI(애플 Foundation Models·Gemini Nano) **실기기 확인 안 됨**
- 설치 앱(Windows/Mac) 빌드를 최근 돌리지 않음 → `v` 태그를 올려 한 번 확인

### P3 — 기술 부채

- `Editor.tsx`가 큼(약 940줄) → 지우개·올가미·글상자를 훅으로 나누기
- GitHub Actions의 `actions/*@v4`가 Node 20 지원 종료 경고 → 새 판으로 올리기
- 서버: 한 프로세스 + SQLite, 틀린 횟수 제한·메일 횟수 제한이 메모리에만 있음(재시작하면 초기화, 서버 여러 대면 따로 셈). 사용자가 늘면 Redis/DB로
- 웹판은 로그인 세션을 localStorage에 둠 → 웹을 공개 서비스로 열 거면 XSS 대비 점검
- e2e가 길고 `waitForTimeout`이 많음 → 가끔 느린 CI에서 흔들리면 기다림 조건으로 바꾸기
- e2e에 아직 없는 확인: 60쪽 PDF의 10쪽에서 쪽 모아보기를 열면 10쪽이 보이는지, 글상자를 넣고 내보낸 PDF를 그려 글이 보이는지, 폴더 안에서 노트를 열었다 닫으면 폴더가 그대로인지 (2026-11-21에 따로 만든 스크립트로만 확인)
- 계정 로그인·가입 요청(`sync/account.ts`의 `call`)과 결과 공유·저장(`platform/saveResult*.ts`)에는 아직 시간 제한이 없음 → `net-errors.ts`의 `withTimeLimit`으로 감싸기
- `PageText.kt`의 `json()`은 실기기에서 늘 빈 값일 것으로 보임 (PdfRenderer가 줄 상자를 안 줌). 로그로 확인되면 지우거나 `page.selectContent()`로 줄 상자를 얻는 길을 시험

---

## 7. 갤럭시탭 실기기 점검표 (빌드 21 이상)

1. 위 고정 주소로 APK 받아 **덮어 설치** → 예전 노트가 그대로 있는지, **예전에 사라졌던 필기가 돌아왔는지**
2. 새 노트 → 펜으로 몇 줄 쓰기 → **요약** → `‹ 노트로` → **필기가 그대로인지** → 앱을 완전히 껐다 켜도 그대로인지
3. **S펜 옆 단추를 누른 채** 획 위를 문지르기 → 지워지는지 / 쓰다가 단추 누르기 → 그때부터 지워지는지
4. 펜 도구를 **한 번 더 눌러** 설정 창 → 볼펜·만년필·붓펜·연필·붓, 파선·점선, 굵기 → 견본과 실제 획이 같은지
5. 형광펜 설정 → 투명도, 직선 자동 보정, **글자 크기에 맞춰 두께 조절** 켜고 PDF 글줄 위에 비뚤게 칠하기 → 글줄에 딱 맞는지
6. 지우개 설정 → **영역 지우개**로 획 가운데만 지우기 → 되돌리기 한 번에 원래대로 / 형광펜만 지우기 / 이 쪽 모두 지우기
7. 올가미 → 사각형, 부분 선택 포함
8. **PDF 교재(가능하면 스캔본)** 에 형광펜·밑줄·동그라미·여러 줄 손글씨 → **요약** → 칠한 글자가 글자로 나오는지, 손글씨가 줄마다 맞게 읽히는지
9. 같은 PDF에서 **낱말 가운데부터** 칠하기, **보기(①②③④)** 하나 칠하기, **이웃한 두 줄에 밑줄** 긋기 → 요약에서 글자가 붙어 나오는지("사용자[가 …자]원"), 번호가 맞는지("② [가상현실]"), 밑줄 친 두 줄이 다 나오는지. 받침 있는 손글씨("안녕", "한글")가 한 줄로 읽히는지
10. 펜·형광펜·지우개 단추를 한 번 더 눌러 설정 창 → **그 단추 바로 밑**에 뜨는지, 빠르게 두 번 눌러도 열린 채인지, 펜 견본 굵기가 실제 획과 비슷한지
11. '손가락: 쓰기'로 두고 **두 손가락으로 벌리기**를 여러 번 → 쪽에 점이 안 남는지. 축소해서 회색 여백에 펜을 대도 안 써지는지
12. PDF 노트 1쪽에서 ⋯ → **뒤에 빈 쪽** → 빈 쪽이 정말 비었는지, 다음 쪽이 교재 2쪽인지. 10쪽 넘는 PDF의 뒤쪽에서 **쪽 모아보기** → 보던 쪽이 보이고 위아래로 다 굴러가는지
13. 1쪽에 쓰고 2쪽으로 넘긴 뒤 **되돌리기** → 1쪽으로 넘어가며 안내가 뜨는지. 3쪽에서 **요약** → `‹ 노트로` → 3쪽으로 돌아오는지
14. 필기 화면·요약 화면에서 **뒤로 단추**(또는 뒤로 쓸기) → 앱이 닫히지 않고 앞 화면으로 가는지. 쓰자마자 홈 단추 → 앱을 밀어 끄기 → 다시 열어 마지막 획이 남았는지
15. '붓'으로 점·짧은 획·작은 글씨 쓰기 → 보이는지. 글상자 몇 개 넣고 **PDF로 내보내기** → 다른 앱에서 글이 다 보이는지
18. 설정 → 화면 밝기를 밝게·어둡게·기기 설정 따르기로 바꿔 보기 → 모든 화면(목록·필기·도구 설정·메뉴·요약·동기화)이 바로 바뀌고 글이 잘 보이는지
16. 필기 많은 쪽(선 100개쯤)에서 손가락으로 빠르게 밀고 떼기 → 미끄러지다 멈추는지, 움직이는 동안 살짝 흐렸다가 멈추면 선명해지는지. 손가락을 멈췄다가 떼면 안 미끄러지는지. 새 노트를 만들면 쪽이 화면 폭에 맞춰 열리는지
19. PDF 교재에 여러 색 형광펜·밑줄·동그라미·옆 메모를 하고 **요약 → 나만의 노트** → 색 뜻을 하나 고치고, 항목 하나 빼고, 메모 하나 더한 뒤 '노트로 만들기' → 새 노트가 바로 열리고, 쪽 순서·꼬리표·메모가 맞는지, 글끼리 겹치지 않는지. 목록에서 원본 노트와 같은 폴더에 있는지
20. 앱을 열면 아래 회색 띠(제스처 줄)가 없는지 → 아래 끝에서 위로 쓸면 잠깐 나타났다가 숨는지 → 홈으로 나가기, PDF 가져오기(파일 창) 뒤에도 숨어 있는지
17. 이상하면: §3-4대로 `adb logcat -d > logcat.txt` 받아서 같이 보기 (요약 글자 문제면 `adb logcat -d -s PdfPages`도)

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
