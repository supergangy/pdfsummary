// 만든 PDF를 공유(파일 앱에 저장, 카톡·메일 등)
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function sharePdf(bytes: Uint8Array, name: string): Promise<void> {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "노트";
  const f = new File(Paths.cache, `${safe}.pdf`);
  if (f.exists) f.delete();
  f.write(bytes);
  await Sharing.shareAsync(f.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: safe });
}
