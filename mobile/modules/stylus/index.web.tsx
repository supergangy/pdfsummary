// 웹: 펜의 옆 단추(barrel, buttons 2)나 지우개 끝(buttons 32)을 포인터 이벤트로 읽는다.
import { useRef } from "react";
import { View, type ViewProps } from "react-native";

export type StylusViewProps = ViewProps & { onButton?: (pressed: boolean) => void };

type PE = { nativeEvent: { pointerType?: string; buttons?: number } };

export function StylusView({ onButton, ...rest }: StylusViewProps) {
  const last = useRef(false);
  const watch = (e: PE) => {
    const ev = e.nativeEvent;
    if (ev.pointerType !== "pen") return;
    const now = ((ev.buttons ?? 0) & (2 | 32)) !== 0;
    if (now !== last.current) {
      last.current = now;
      onButton?.(now);
    }
  };
  const extra = { onPointerDown: watch, onPointerMove: watch, onPointerUp: watch } as unknown as ViewProps;
  return <View {...rest} {...extra} />;
}
