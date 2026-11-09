// PDF 내보내기에 넣을 한글 글꼴(나눔고딕, OFL) 파일 읽기
import { Asset } from "expo-asset";
import { File } from "expo-file-system";

let cached: Promise<Uint8Array> | null = null;

export function koreanFont(): Promise<Uint8Array> {
  cached ??= (async () => {
    const a = Asset.fromModule(require("../../assets/fonts/NanumGothic-Regular.ttf"));
    await a.downloadAsync();
    return new File(a.localUri ?? a.uri).bytes();
  })();
  return cached;
}
