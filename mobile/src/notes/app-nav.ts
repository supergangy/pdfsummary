// 화면을 오갈 때 쓰는 작은 규칙들 (React·기기 코드 없음 → 단위 테스트로 확인)

/**
 * 안드로이드 '뒤로'를 눌렀을 때 갈 화면. null이면 App이 처리하지 않는다:
 * 목록에서는 앱이 닫히고, 필기 화면은 Editor가 저장한 뒤 스스로 닫는다.
 */
export function backTarget<S extends { name: string; backTo?: S }>(screen: S, library: S): S | null {
  if (screen.name === "library" || screen.name === "editor") return null;
  return screen.backTo ?? library;
}

/** 화면이 뜬 지 얼마 안 됐는가 (단추를 빠르게 두 번 누를 때 두 번째 누름이 새 화면의 단추를 누르는 것을 막는다) */
export function tooSoon(openedAt: number, now: number, ms = 400): boolean {
  return now - openedAt < ms;
}

/** 고른 폴더가 아직 있으면 그대로, 지워져 없으면 '전체'(null) */
export function keepFolder(folder: string | null, folders: string[]): string | null {
  return folder !== null && folders.includes(folder) ? folder : null;
}
