// 서버·파일 일이 안 될 때: 끝없이 기다리지 않게 시간 제한을 두고, 영어 오류 대신 쉬운 말을 고른다.
// (화면과 분리해서 Node로도 시험할 수 있게 여기에 모았다)

/** 짧은 요청(연결 확인·상태 묻기): 이 시간 안에 대답이 없으면 끊는다 */
export const SHORT_MS = 12000;
/** 서버가 일을 하고 나서 대답하는 요청(색 찾기·노트 PDF 만들기·결과 받기) */
export const LONG_MS = 180000;
/** 파일 올리기: 이 시간 동안 조금도 나아가지 않으면 끊는다 (전체 시간은 재지 않는다 — 큰 파일은 오래 걸린다) */
export const STALL_MS = 30000;
/** 파일을 다 보낸 뒤 서버가 확인하고 대답할 때까지 기다리는 시간 */
export const SENT_WAIT_MS = 90000;

export const NO_ANSWER = "서버가 대답하지 않아요. 서버 주소가 맞는지, 서버가 켜져 있는지 확인해 주세요.";

export type Limit = {
  signal: AbortSignal; // 시간이 다 되면 꺼진다 → fetch·올리기에 넘겨 그 일을 멈춘다
  alive: (nextMs?: number) => void; // 진행이 있었다 → 시간을 처음부터 다시 잰다
};

/** run을 시작하고, ms 동안 끝나지도 않고 alive()도 불리지 않으면 fail()이 만든 오류로 끝낸다.
 *  run이 signal을 무시해도(대답 없는 서버) 기다리는 쪽은 바로 풀려난다. */
export function withTimeLimit<T>(ms: number, fail: () => Error, run: (l: Limit) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const alive = (nextMs = ms) => {
      clearTimeout(timer);
      if (done) return;
      timer = setTimeout(() => {
        done = true;
        reject(fail()); // 먼저 우리 오류로 끝낸다 → 아래에서 멈추며 생기는 AbortError는 버려진다
        ctl.abort();
      }, nextMs);
    };
    alive();
    const end = () => {
      done = true;
      clearTimeout(timer);
    };
    (async () => run({ signal: ctl.signal, alive }))().then(
      (v) => {
        end();
        resolve(v);
      },
      (e) => {
        end();
        reject(e);
      },
    );
  });
}

/** PDF를 못 열었을 때 보여 줄 말. 기기·pdf.js가 주는 영어 글은 붙이지 않는다. */
/** 필기를 합친 PDF·노트 파일로 내보낼 때 원본 PDF를 통째로 메모리에 읽는다. 이보다 크면 앱 메모리(안드로이드 약 256MB)가 모자라
 *  내보내기가 실패하므로 미리 알린다. (보기·필기·요약은 쪽마다 읽어서 큰 PDF도 된다) */
export const EXPORT_PDF_MAX = 120 * 1024 * 1024;

/** 원본 PDF가 너무 커서 내보낼 수 없을 때 알림 (크기를 모르면 null = 해 본다) */
export function bigPdfMessage(size: number | null, what = "필기를 합친 PDF"): string | null {
  if (size === null || size <= EXPORT_PDF_MAX) return null;
  return `원본 PDF가 너무 커서(${Math.round(size / 1024 / 1024)}MB) ${what}로 내보낼 수 없어요. 보기·필기·요약은 그대로 할 수 있어요. 내보내려면 ${Math.round(EXPORT_PDF_MAX / 1024 / 1024)}MB 아래로 나눈 PDF로 해 주세요.`;
}

export function pdfOpenMessage(raw: string): string {
  if (/OutOfMemory|out of memory|Failed to allocate/i.test(raw)) return "PDF가 너무 커서 이 기기의 앱 메모리로 읽지 못했어요. 더 작게 나눈 PDF로 해 보세요.";
  if (/암호|password|encrypt/i.test(raw)) return "암호가 걸린 PDF는 가져올 수 없어요.";
  if (/empty|zero bytes/i.test(raw)) return "빈 파일이에요. 다른 파일을 골라 주세요.";
  if (/invalid pdf|corrupt|not in pdf format/i.test(raw)) return "PDF 파일이 깨졌거나 PDF가 아니에요.";
  // 우리가 쓴 한국어 글(예: 쪽이 없는 PDF예요.)은 그대로 보여 준다
  const korean = /[가-힣]/.test(raw) && !/[a-z]{3,}/i.test(raw.replace(/pdf/gi, ""));
  if (korean && !raw.startsWith("PDF를 열 수 없어요")) return `PDF를 열 수 없어요. ${raw}`;
  return "PDF를 열 수 없어요. 파일이 깨졌거나 PDF가 아닐 수 있어요. 다른 파일로 해 보세요.";
}
