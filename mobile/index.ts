import { boot } from "./src/boot";

// 웹판은 그래픽 엔진(Skia)을 먼저 불러온 뒤 앱을 읽어야 해서, 앱은 boot 안에서 require한다.
boot(() => require("./App").default);
