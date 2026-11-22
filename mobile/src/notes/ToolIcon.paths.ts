// 도구 아이콘 모양 (24×24 칸의 SVG 경로). 기기는 Skia로(ToolIcon.tsx), 웹은 SVG로(ToolIcon.web.tsx) 그린다.
export type IconName =
  | "pen" | "highlighter" | "eraser" | "lasso" | "text" | "settings" | "finger" | "hand" | "undo" | "redo"
  | "back" | "prev" | "next" | "more" | "minus" | "plus" | "fit" | "close" | "shapes" | "line";

/** 24×24 칸의 SVG 경로. stroke=선으로, fill=채워서 */
export const PATHS: Record<IconName, { d: string; fill?: boolean }> = {
  pen: { d: "M4 20 L5 15.5 L16 4.5 A1.6 1.6 0 0 1 19.5 8 L8.5 19 Z M14 7 L17 10 M5 15.5 L8.5 19" },
  highlighter: { d: "M4 21 H20 M7 17 L5.5 13 L13.5 5 L17.5 9 L9.5 17 Z M13.5 5 L15 3.5 L19 7.5 L17.5 9" },
  eraser: { d: "M3 20 H21 M6 16 L13.5 8.5 L18 13 L13 18 H8 Z M9 12.5 L14.5 18" },
  lasso: { d: "M12 4 C6.5 4 3.5 6.5 3.5 9.5 C3.5 12.5 7 14.5 10.5 15 M12 4 C17.5 4 20.5 6.5 20.5 9.5 C20.5 12 18 14 14.5 14.8 M10 15 C9 17 8.5 19 10 21 M10.5 15 C12.5 15.3 14 15 14.5 14.8" },
  text: { d: "M5 6 H19 M12 6 V19 M9 19 H15" },
  settings: { d: "M12 8.5 A3.5 3.5 0 1 0 12 15.5 A3.5 3.5 0 1 0 12 8.5 M12 3 V5.5 M12 18.5 V21 M3 12 H5.5 M18.5 12 H21 M5.6 5.6 L7.4 7.4 M16.6 16.6 L18.4 18.4 M5.6 18.4 L7.4 16.6 M16.6 7.4 L18.4 5.6" },
  finger: { d: "M9 11 V5.5 A1.5 1.5 0 0 1 12 5.5 V11 M12 10 A1.5 1.5 0 0 1 15 10.5 V12 M15 11.5 A1.5 1.5 0 0 1 18 12 V16 C18 19 16 21 13 21 H12 C10 21 8.8 20 7.5 18 L5.3 14.5 A1.4 1.4 0 0 1 7.6 13 L9 15 V11" },
  hand: { d: "M6 10 L13 3 M9.5 13.5 L16.5 6.5 M13 17 L20 10 M3 21 L7.5 16.5 M9 11 L13 15" },
  undo: { d: "M9 7 L4 11 L9 15 M4 11 H15 A4.5 4.5 0 0 1 15 20 H10" },
  redo: { d: "M15 7 L20 11 L15 15 M20 11 H9 A4.5 4.5 0 0 0 9 20 H14" },
  back: { d: "M15 5 L8 12 L15 19" },
  prev: { d: "M14.5 6 L9 12 L14.5 18" },
  next: { d: "M9.5 6 L15 12 L9.5 18" },
  more: { d: "M5 12 A1.3 1.3 0 1 0 5.01 12 M12 12 A1.3 1.3 0 1 0 12.01 12 M19 12 A1.3 1.3 0 1 0 19.01 12", fill: true },
  minus: { d: "M6 12 H18" },
  plus: { d: "M6 12 H18 M12 6 V18" },
  fit: { d: "M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15" },
  close: { d: "M6 6 L18 18 M18 6 L6 18" },
  shapes: { d: "M4 20 H12 V12 H4 Z M17 4 L21 11 H13 Z" },
  line: { d: "M4 18 L20 6" },
};

