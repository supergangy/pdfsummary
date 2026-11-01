// 웹(미리보기·시험용): XMLHttpRequest로 진행률을 받으며 올린다.
import { ApiError, authHeaders, parseUpload, uploadUrl, type Settings, type UploadInfo } from "../api";
import type { Picked } from "./types";

export function uploadPdf(s: Settings, picked: Picked, onProgress: (ratio: number) => void): Promise<UploadInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl(s, picked.name));
    for (const [k, v] of Object.entries(authHeaders(s))) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try {
        resolve(parseUpload(xhr.status, xhr.responseText));
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new ApiError("서버에 연결할 수 없어요. 인터넷과 서버 주소를 확인해 주세요."));
    xhr.send(picked.webFile ?? null);
  });
}
