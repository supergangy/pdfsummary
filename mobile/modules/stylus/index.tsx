// S펜 감싸개. 안드로이드는 네이티브 뷰가 펜 옆 단추 상태와 펜이 떠 있는 자리를 알리고, 그 밖에서는 그냥 View.
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import { View, type ViewProps } from "react-native";

/** hover: 펜이 화면에 닿지 않고 떠 있을 때 바뀐 것인지.
 *  onHover: 펜(마우스)이 이 뷰 위에 떠 있는 자리 (이 뷰 기준 dp), 떠났으면 exit */
export type StylusViewProps = ViewProps & {
  onButton?: (pressed: boolean, hover: boolean) => void;
  onHover?: (x: number, y: number, exit: boolean) => void;
};

type NativeProps = ViewProps & {
  onButton?: (e: { nativeEvent: { pressed: boolean; hover?: boolean } }) => void;
  onHover?: (e: { nativeEvent: { x: number; y: number; exit: boolean } }) => void;
  hoverEvents?: boolean;
};

const Native: ComponentType<NativeProps> | null = requireOptionalNativeModule("Stylus") ? requireNativeView<NativeProps>("Stylus") : null;

export function StylusView({ onButton, onHover, ...rest }: StylusViewProps) {
  if (!Native) return <View {...rest} />;
  return (
    <Native
      {...rest}
      onButton={onButton ? (e) => onButton(e.nativeEvent.pressed, !!e.nativeEvent.hover) : undefined}
      hoverEvents={!!onHover}
      onHover={onHover ? (e) => onHover(e.nativeEvent.x, e.nativeEvent.y, e.nativeEvent.exit) : undefined}
    />
  );
}
