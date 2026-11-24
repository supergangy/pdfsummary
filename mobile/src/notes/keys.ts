// 키보드 단축키 (기기: 블루투스·북커버 키보드). 네이티브 Stylus 모듈이 창의 키 입력을 알려 준다.
// 글 쓰는 칸에 입력 중일 때는 오지 않는다.
import { requireOptionalNativeModule } from "expo";
import { useEffect, useRef } from "react";

export type KeyPress = { key: string; ctrl: boolean; shift: boolean; alt: boolean; repeat: boolean };

type Mod = {
  listenKeys?: () => boolean;
  addListener?: (name: "onKey", fn: (e: KeyPress) => void) => { remove(): void };
};
const M = requireOptionalNativeModule<Mod>("Stylus");

/** 키를 누를 때마다 handler (true를 돌려주면 처리한 것) */
export function useKeys(handler: (k: KeyPress) => boolean | void, active = true) {
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    if (!active || !M?.addListener) return;
    // 화면이 새로 만들어졌을 수 있으니 매번 단다 (이미 달려 있으면 기기 쪽에서 그대로 둔다)
    M.listenKeys?.();
    const sub = M.addListener("onKey", (e) => void h.current(e));
    return () => sub.remove();
  }, [active]);
}
