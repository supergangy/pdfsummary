// 도구 모음 아이콘 (펜·형광펜·지우개·올가미·글상자·설정·손가락·되돌리기 …): Skia 경로로 그린 선 그림.
// 글자 대신 그림이라 좁은 한 줄 도구 모음에 들어간다. 모양은 ToolIcon.paths.ts, 웹은 ToolIcon.web.tsx.
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { useMemo } from "react";

import { PATHS, type IconName } from "./ToolIcon.paths";

export type { IconName };

export function ToolIcon({ name, color, size = 22 }: { name: IconName; color: string; size?: number }) {
  const path = useMemo(() => Skia.Path.MakeFromSVGString(PATHS[name].d)!, [name]);
  const k = size / 24;
  const fill = PATHS[name].fill;
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Path path={path} color={color} style={fill ? "fill" : "stroke"} strokeWidth={1.8} strokeCap="round" strokeJoin="round" transform={[{ scale: k }]} />
    </Canvas>
  );
}
