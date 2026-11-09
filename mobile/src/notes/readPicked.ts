// 고른 파일의 내용 읽기 (기기)
import { File } from "expo-file-system";

export async function readPicked(p: { uri: string; webFile?: Blob }): Promise<Uint8Array> {
  return new File(p.uri).bytes();
}
