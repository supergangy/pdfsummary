// 스티커 모음. 도장(중요·암기 …)은 글상자로, 그림(별·체크 …)은 쪽에 붙이는 그림(PNG)으로 넣는다.
// 그림은 100×100 칸의 SVG 경로로 정의하고, 넣을 때 그림으로 만든다 (insertImage.ts의 stickerPicture).

/** 공부할 때 자주 쓰는 도장: 둥근 테두리 + 옅은 바탕 + 굵은 글 */
export const STAMPS: { text: string; color: string }[] = [
  { text: "중요", color: "#D7263D" },
  { text: "★ 핵심", color: "#C9A100" },
  { text: "암기", color: "#1E4FD8" },
  { text: "시험 출제", color: "#E67E22" },
  { text: "복습", color: "#0F8A5F" },
  { text: "모름", color: "#7A3EC8" },
  { text: "다시 보기", color: "#6B7280" },
  { text: "질문", color: "#0EA5E9" },
];

export type StickerPart = { d: string; fill?: string; stroke?: string; width?: number };
export type Sticker = { id: string; label: string; parts: StickerPart[] };

const CIRCLE = "M50 4 A46 46 0 1 1 49.99 4 Z";
const dot = (x: number, y: number, r = 5.5) => `M${x - r} ${y} A${r} ${r} 0 1 0 ${x + r} ${y} A${r} ${r} 0 1 0 ${x - r} ${y} Z`;

export const STICKERS: Sticker[] = [
  { id: "star", label: "별", parts: [{ d: "M50 5 L62 37 L96 38 L69 58 L79 92 L50 72 L21 92 L31 58 L4 38 L38 37 Z", fill: "#FFC83D", stroke: "#D9A300", width: 3 }] },
  { id: "check", label: "체크", parts: [{ d: CIRCLE, fill: "#22A55B" }, { d: "M27 52 L44 69 L75 35", stroke: "#FFFFFF", width: 10 }] },
  { id: "cross", label: "엑스", parts: [{ d: CIRCLE, fill: "#E5484D" }, { d: "M32 32 L68 68 M68 32 L32 68", stroke: "#FFFFFF", width: 10 }] },
  { id: "heart", label: "하트", parts: [{ d: "M50 90 C20 67 5 49 5 32 C5 17 16 7 30 7 C40 7 47 13 50 21 C53 13 60 7 70 7 C84 7 95 17 95 32 C95 49 80 67 50 90 Z", fill: "#FF5C8A" }] },
  { id: "exclaim", label: "느낌표", parts: [{ d: CIRCLE, fill: "#F59E0B" }, { d: "M50 22 L50 58", stroke: "#FFFFFF", width: 11 }, { d: dot(50, 75, 6.5), fill: "#FFFFFF" }] },
  { id: "question", label: "물음표", parts: [{ d: CIRCLE, fill: "#3B82F6" }, { d: "M36 38 C36 25 45 19 52 19 C62 19 67 27 67 35 C67 46 52 48 52 60", stroke: "#FFFFFF", width: 10 }, { d: dot(52, 76, 6.5), fill: "#FFFFFF" }] },
  { id: "arrow", label: "화살표", parts: [{ d: "M6 40 H58 V20 L95 50 L58 80 V60 H6 Z", fill: "#D7263D" }] },
  { id: "pin", label: "압정", parts: [{ d: "M30 10 H70 L64 40 L78 58 H22 L36 40 Z", fill: "#EF4444" }, { d: "M50 58 L50 94", stroke: "#6B7280", width: 6 }] },
];
