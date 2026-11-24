// 요약 내보내기 (기기): 글 복사 · 글로 보내기(카톡·메모·삼성 노트 등) · PDF로 보내기 · 웹페이지(HTML)로 보내기
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";

import { shareFile } from "./shareFile";

const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "요약";

export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}

/** 글 그대로 공유 시트로 (받는 앱이 글로 받는다: 카톡 대화, 메모·노트 앱 새 메모 등) */
export async function shareText(text: string, title: string): Promise<void> {
  await Share.share({ message: text, title }, { dialogTitle: title });
}

/** 요약 화면(HTML)을 그대로 PDF로 만들어 공유 */
export async function shareHtmlAsPdf(html: string, name: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html, margins: { left: 24, right: 24, top: 32, bottom: 32 } });
  const made = new File(uri);
  const out = new File(Paths.cache, `${safe(name)}.pdf`);
  if (out.exists) out.delete();
  await made.move(out);
  await Sharing.shareAsync(out.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: name });
}

export function shareHtml(html: string, name: string): Promise<void> {
  return shareFile(html, `${safe(name)}.html`, "text/html");
}
