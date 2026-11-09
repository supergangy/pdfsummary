import { Asset } from "expo-asset";

let cached: Promise<Uint8Array> | null = null;

export function koreanFont(): Promise<Uint8Array> {
  cached ??= (async () => {
    const a = Asset.fromModule(require("../../assets/fonts/NanumGothic-Regular.ttf"));
    return new Uint8Array(await (await fetch(a.uri)).arrayBuffer());
  })();
  return cached;
}
