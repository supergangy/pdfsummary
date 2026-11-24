// 요약 내보내기 (웹): 글 복사 · 글로 보내기(공유가 되면 공유, 아니면 .txt 내려받기) · PDF(인쇄 창에서 'PDF로 저장') · HTML 내려받기
import { shareFile } from "./shareFile";

const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "요약";

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function shareText(text: string, title: string): Promise<void> {
  const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, text });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // 사용자가 닫음
    }
  }
  await shareFile(text, `${safe(title)}.txt`, "text/plain");
}

/** 웹: 요약을 새 창에 띄워 인쇄 창을 연다 (거기서 'PDF로 저장') */
export async function shareHtmlAsPdf(html: string, name: string): Promise<void> {
  const w = window.open("", "_blank");
  if (!w) throw new Error("새 창을 열 수 없어요. 팝업 차단을 풀어 주세요.");
  w.document.open();
  w.document.write(html.replace(/<title>[^<]*<\/title>/, `<title>${name.replace(/[<>&]/g, "")}</title>`));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

export function shareHtml(html: string, name: string): Promise<void> {
  return shareFile(html, `${safe(name)}.html`, "text/html");
}
