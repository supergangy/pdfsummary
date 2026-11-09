import { shareFile } from "./shareFile";

export function sharePdf(bytes: Uint8Array, name: string): Promise<void> {
  return shareFile(bytes, `${name || "노트"}.pdf`, "application/pdf");
}
