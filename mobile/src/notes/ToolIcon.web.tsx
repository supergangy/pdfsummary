// 웹판 아이콘: 보통 SVG로 그린다. (Skia 캔버스는 하나마다 WebGL 문맥을 써서, 아이콘 17개 + 쪽 그림판이면
// 브라우저 한도(16개쯤)를 넘어 처음 것들이 빈 상자로 나왔다.) 모양 정의는 ToolIcon.tsx와 같이 쓴다.
import { createElement } from "react";
import { PATHS, type IconName } from "./ToolIcon.paths";

export type { IconName };

export function ToolIcon({ name, color, size = 22 }: { name: IconName; color: string; size?: number }) {
  const p = PATHS[name];
  return createElement(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", style: { display: "block", pointerEvents: "none" }, "aria-hidden": true },
    createElement("path", {
      d: p.d,
      fill: p.fill ? color : "none",
      stroke: p.fill ? "none" : color,
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}
