# CLAUDE.md — 이 저장소에서 일할 때의 규칙

자세한 진행 상황·남은 일·명령은 **[HANDOFF.md](HANDOFF.md)** 에 있다. 작업을 시작하기 전에 읽고, 끝나면 그 문서의 §0(상태)과 §6(남은 일)을 고친다.

## 프로젝트
- PDF·스캔본에 **내가 표시한 부분만** 뽑아 요약하는 파이썬 프로그램(`pdfsummary/`, 서버 포함) + 필기 앱(`mobile/`, Expo SDK 58 · RN 0.88 · Skia · gesture-handler v3 · reanimated 4).
- 사용자는 한국어 사용자이고 개발자가 아니다. **답과 화면 글·코드 주석은 쉬운 한국어**로.

## 반드시
- 기능을 바꾸면 시험도: 파이썬 `pytest -q`, 앱 `cd mobile && npm run typecheck && npm test`, 화면 흐름은 `mobile/e2e/*.e2e.cjs`(웹판 `npx expo export --platform web --output-dir dist-web` 뒤 `node e2e/notes.e2e.cjs dist-web`).
- 기기 파일 저장은 `mobile/src/notes/fileFs.ts`만 거친다. expo-file-system의 `write`·`move`·`copy`는 **비동기라 꼭 await** (기다리지 않아 필기가 사라진 적 있음).
- 획(`Stroke`) 데이터에 새 속성은 **선택 칸으로만** (예전 노트·다른 기기 동기화 호환).
- 사용자 교재 PDF·비밀값(API 키·비밀번호·서명 키)은 저장소에 넣지 않는다. 시험 PDF는 `examples/make_sample.py`로 만든다.
- `mobile/app.json`의 `enableMinifyInReleaseBuilds: false`, `useLegacyPackaging: true`는 이유가 있다 (HANDOFF.md §5-2). 바꾸려면 에뮬레이터 시험(`mobile-native.yml`의 android-smoke)으로 확인.
- push하면 CI(`점검`, `앱 네이티브 빌드`)가 초록색인지 확인한다. 안드로이드 APK는 CI가 릴리스로 올린다.

## 커밋
- 커밋 메시지는 한국어로, 무엇을·왜를 적는다.
