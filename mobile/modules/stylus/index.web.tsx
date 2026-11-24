// 웹: 펜의 옆 단추(barrel, buttons 2)나 지우개 끝(buttons 32)을 포인터 이벤트로 읽는다.
// onHover: 펜·마우스가 버튼을 누르지 않고 떠 있는 자리 (이 뷰 기준), 떠났거나 눌렀으면 exit
import { useRef } from "react";
import { View, type ViewProps } from "react-native";

export type StylusViewProps = ViewProps & {
  onButton?: (pressed: boolean, hover: boolean) => void;
  onHover?: (x: number, y: number, exit: boolean) => void;
};

type PE = { nativeEvent: { pointerType?: string; buttons?: number; clientX?: number; clientY?: number }; currentTarget?: unknown };

export function StylusView({ onButton, onHover, ...rest }: StylusViewProps) {
  const last = useRef(false);
  const watch = (e: PE) => {
    const ev = e.nativeEvent;
    if (ev.pointerType !== "pen") return;
    const now = ((ev.buttons ?? 0) & (2 | 32)) !== 0;
    if (now !== last.current) {
      last.current = now;
      onButton?.(now, ((ev.buttons ?? 0) & 1) === 0); // 1 = 펜 끝이 닿음
    }
  };
  const hover = (e: PE) => {
    if (!onHover) return;
    const ev = e.nativeEvent;
    if (ev.pointerType === "touch") return;
    if ((ev.buttons ?? 0) !== 0) return onHover(0, 0, true);
    const el = e.currentTarget as { getBoundingClientRect?: () => { left: number; top: number } } | undefined;
    const r = el?.getBoundingClientRect?.();
    if (!r) return;
    onHover((ev.clientX ?? 0) - r.left, (ev.clientY ?? 0) - r.top, false);
  };
  // onPointerMove는 펜이 떠 있을 때도 온다 (두 번 누르기를 떠 있을 때 알려고)
  const extra = {
    onPointerDown: (e: PE) => {
      watch(e);
      onHover?.(0, 0, true);
    },
    onPointerMove: (e: PE) => {
      watch(e);
      hover(e);
    },
    onPointerUp: watch,
    onPointerLeave: () => onHover?.(0, 0, true),
  } as unknown as ViewProps;
  return <View {...rest} {...extra} />;
}
