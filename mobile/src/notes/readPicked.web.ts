// 고른 파일의 내용 읽기 (웹)
export async function readPicked(p: { uri: string; webFile?: Blob }): Promise<Uint8Array> {
  const blob = p.webFile ?? (await (await fetch(p.uri)).blob());
  return new Uint8Array(await blob.arrayBuffer());
}
