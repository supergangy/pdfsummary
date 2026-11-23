// S펜 옆 단추 감싸개·단추 이름표 감싸개. 안드로이드는 네이티브 뷰가 단추 상태를 알리고(이름표는 펜을 띄우면 뜨고), 그 밖에서는 그냥 View.
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

/** 단추 이름표: S펜을 단추 위에 띄우거나 길게 누르면 text가 뜬다 (안드로이드 기본 툴팁) */
export type TooltipViewProps = ViewProps & { text: string };

const NativeTip: ComponentType<TooltipViewProps> | null = requireOptionalNativeModule("Tooltip") ? requireNativeView<TooltipViewProps>("Tooltip") : null;

export function TooltipView(props: TooltipViewProps) {
  if (!NativeTip) {
    const { text: _text, ...rest } = props;
    return <View {...rest} />;
  }
  return <NativeTip {...props} />;
}
