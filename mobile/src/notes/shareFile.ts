// 만든 파일을 공유(파일 앱에 저장, 카톡·메일 등)
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

const UTI: Record<string, string> = { "application/pdf": "com.adobe.pdf", "text/html": "public.html" };

export async function shareFile(data: Uint8Array | string, name: string, mime: string): Promise<void> {
  const f = new File(Paths.cache, name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 140));
  if (f.exists) f.delete();
  f.write(data);
  await Sharing.shareAsync(f.uri, { mimeType: mime, UTI: UTI[mime], dialogTitle: name });
}
