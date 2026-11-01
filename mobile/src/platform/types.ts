/** 고른(또는 공유받은) PDF 한 개. */
export type Picked = {
  uri: string;
  name: string;
  size?: number | null;
  mimeType?: string | null;
  webFile?: Blob; // 웹에서만
};
