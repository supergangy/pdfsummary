// 웹에는 '공유받기'가 없다.
export function useShareIntent(_opts?: unknown) {
  return {
    isReady: true,
    hasShareIntent: false,
    shareIntent: { files: null, type: null, webUrl: null, text: null },
    resetShareIntent: () => {},
    error: null as string | null,
  };
}
