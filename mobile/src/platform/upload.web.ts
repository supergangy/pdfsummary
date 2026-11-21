// 웹(미리보기·시험용): XMLHttpRequest로 진행률을 받으며 올린다.
import { ApiError, authHeaders, parseUpload, uploadUrl, type Settings, type UploadInfo } from "../api";
import { NO_ANSWER, SENT_WAIT_MS, STALL_MS, withTimeLimit } from "../notes/net-errors";
import type { Picked } from "./types";

export function uploadPdf(s: Settings, picked: Picked, onProgress: (ratio: number) => void): Promise<UploadInfo> {
  // 큰 파일도 있으니 전체 시간은 재지 않고, 진행이 한동안 없을 때만 끊는다 (대답 없는 서버에서 끝없이 돌지 않게)
  return withTimeLimit(STALL_MS, () => new ApiError(NO_ANSWER), ({ signal, alive }) => new Promise<UploadInfo>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl(s, picked.name));
    for (const [k, v] of Object.entries(authHeaders(s))) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = (e) => {
      // 다 보낸 뒤에는 서버가 파일을 확인하는 동안 조금 더 기다린다
      alive(e.lengthComputable && e.loaded >= e.total ? SENT_WAIT_MS : STALL_MS);
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        resolve(parseUpload(xhr.status, xhr.responseText));
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new ApiError("서버에 연결할 수 없어요. 인터넷과 서버 주소를 확인해 주세요."));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(picked.webFile ?? null);
  }));
}
