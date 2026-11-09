import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import { registerRootComponent } from "expo";
import type { ComponentType } from "react";

// 웹: CanvasKit(public/canvaskit.wasm)을 먼저 불러온다. Skia를 쓰는 모듈은 그 뒤에 읽혀야 한다.
export function boot(load: () => ComponentType) {
  LoadSkiaWeb({ locateFile: (f: string) => `/${f}` }).then(() => registerRootComponent(load()));
}
