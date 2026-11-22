// S펜 옆 단추 감싸개. 안드로이드는 네이티브 뷰가 단추 상태를 알리고, 그 밖에서는 그냥 View.
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import { View, type ViewProps } from "react-native";

/** hover: 펜이 화면에 닿지 않고 떠 있을 때 바뀐 것인지 */
export type StylusViewProps = ViewProps & { onButton?: (pressed: boolean, hover: boolean) => void };

type NativeProps = ViewProps & { onButton?: (e: { nativeEvent: { pressed: boolean; hover?: boolean } }) => void };

const Native: ComponentType<NativeProps> | null = requireOptionalNativeModule("Stylus") ? requireNativeView<NativeProps>("Stylus") : null;

export function StylusView({ onButton, ...rest }: StylusViewProps) {
  if (!Native) return <View {...rest} />;
  return <Native {...rest} onButton={onButton ? (e) => onButton(e.nativeEvent.pressed, !!e.nativeEvent.hover) : undefined} />;
}
