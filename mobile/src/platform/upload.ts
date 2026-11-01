// 휴대폰·태블릿: 파일을 통째로(본문 그대로) PUT으로 올린다. 진행률 표시.
import { File, UploadType } from "expo-file-system";
import { authHeaders, parseUpload, uploadUrl, type Settings, type UploadInfo } from "../api";
import type { Picked } from "./types";

export async function uploadPdf(s: Settings, picked: Picked, onProgress: (ratio: number) => void): Promise<UploadInfo> {
  const file = new File(picked.uri);
  const task = file.createUploadTask(uploadUrl(s, picked.name), {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: "application/pdf",
    headers: { ...authHeaders(s), "Content-Type": "application/pdf" },
    onProgress: ({ bytesSent, totalBytes }) => onProgress(totalBytes ? bytesSent / totalBytes : 0),
  });
  const res = await task.uploadAsync();
  return parseUpload(res.status, res.body);
}
