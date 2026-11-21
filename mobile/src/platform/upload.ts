// 휴대폰·태블릿: 파일을 통째로(본문 그대로) PUT으로 올린다. 진행률 표시.
import { File, UploadType } from "expo-file-system";
import { ApiError, authHeaders, parseUpload, uploadUrl, type Settings, type UploadInfo } from "../api";
import { NO_ANSWER, SENT_WAIT_MS, STALL_MS, withTimeLimit } from "../notes/net-errors";
import type { Picked } from "./types";

export async function uploadPdf(s: Settings, picked: Picked, onProgress: (ratio: number) => void): Promise<UploadInfo> {
  let res: { status: number; body: string };
  try {
    // 큰 파일도 있으니 전체 시간은 재지 않고, 진행이 한동안 없을 때만 끊는다 (대답 없는 서버에서 끝없이 돌지 않게)
    res = await withTimeLimit(STALL_MS, () => new ApiError(NO_ANSWER), ({ signal, alive }) => {
      const file = new File(picked.uri);
      const task = file.createUploadTask(uploadUrl(s, picked.name), {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: "application/pdf",
        headers: { ...authHeaders(s), "Content-Type": "application/pdf" },
        signal,
        onProgress: ({ bytesSent, totalBytes }) => {
          // 다 보낸 뒤에는 서버가 파일을 확인하는 동안 조금 더 기다린다
          alive(totalBytes && bytesSent >= totalBytes ? SENT_WAIT_MS : STALL_MS);
          onProgress(totalBytes ? bytesSent / totalBytes : 0);
        },
      });
      return task.uploadAsync();
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.warn("올리기 실패:", (e as Error)?.message); // 기기가 주는 영어 글은 기록에만 남긴다
    throw new ApiError("파일을 올리지 못했어요. 인터넷과 서버 주소를 확인해 주세요.");
  }
  return parseUpload(res.status, res.body);
}
