import { authHeaders, resultUrl, type ResultFile, type Settings } from "../api";

export async function shareResult(s: Settings, job: string, file: ResultFile, stem: string): Promise<void> {
  const r = await fetch(resultUrl(s, job, file), { headers: authHeaders(s) });
  if (!r.ok) throw new Error("결과 파일을 받지 못했어요.");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem}_${file}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
