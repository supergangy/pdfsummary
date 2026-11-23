// 웹: 펜의 옆 단추(barrel, buttons 2)나 지우개 끝(buttons 32)을 포인터 이벤트로 읽는다.
import { useRef } from "react";
import { View, type ViewProps } from "react-native";

export type StylusViewProps = ViewProps & { onButton?: (pressed: boolean, hover: boolean) => void };

type PE = { nativeEvent: { pointerType?: string; buttons?: number } };

export function StylusView({ onButton, ...rest }: StylusViewProps) {
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
  // onPointerMove는 펜이 떠 있을 때도 온다 (두 번 누르기를 떠 있을 때 알려고)
  const extra = { onPointerDown: watch, onPointerMove: watch, onPointerUp: watch } as unknown as ViewProps;
  return <View {...rest} {...extra} />;
}

/** 단추 이름표: 웹은 단추의 접근성 이름(aria-label)으로 충분해서 그냥 View */
export type TooltipViewProps = ViewProps & { text: string };

export function TooltipView({ text: _text, ...rest }: TooltipViewProps) {
  return <View {...rest} />;
}
