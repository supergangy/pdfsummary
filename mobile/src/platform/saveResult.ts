// 결과 파일을 받아 공유 시트로 보낸다 (파일 앱에 저장, 노션·카톡으로 보내기 등).
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { authHeaders, resultUrl, type ResultFile, type Settings } from "../api";

const MIME: Record<ResultFile, string> = {
  "요약.html": "text/html",
  "요약.md": "text/markdown",
  "요약.json": "application/json",
  "요약.zip": "application/zip",
};

export async function shareResult(s: Settings, job: string, file: ResultFile, stem: string): Promise<void> {
  const target = new File(Paths.cache, `${stem}_${file}`);
  if (target.exists) target.delete();
  const saved = await File.downloadFileAsync(resultUrl(s, job, file), target, { headers: authHeaders(s) });
  if (!(await Sharing.isAvailableAsync())) throw new Error("이 기기에서는 공유를 쓸 수 없어요.");
  await Sharing.shareAsync(saved.uri, { mimeType: MIME[file], dialogTitle: `${stem} 요약` });
}
