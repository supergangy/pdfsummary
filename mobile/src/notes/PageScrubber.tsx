// 아래쪽 쪽 이동 막대: 막대를 누르거나 끌면 그 쪽으로 바로 간다 (긴 노트를 빨리 넘기기).
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { floating, useTheme } from "../ui";
import { scrubIndex } from "./editor-logic";

export function PageScrubber({ count, index, onSeek, onAskPage }: { count: number; index: number; onSeek: (i: number) => void; onAskPage: () => void }) {
  const t = useTheme();
  const width = useRef(1);
  const [held, setHeld] = useState<number | null>(null); // 끄는 동안 손가락이 가리키는 쪽
  const last = useRef(-1);
  // 제스처는 처음 만든 함수를 계속 쓸 수 있으므로 늘 최신 값을 ref로 읽는다
  const live = useRef({ count, onSeek });
  live.current = { count, onSeek };
  const api = useRef({
    seek: (x: number) => {
      const i = scrubIndex(x, width.current, live.current.count);
      setHeld(i);
      if (i !== last.current) {
        last.current = i;
        live.current.onSeek(i);
      }
    },
    done: () => {
      setHeld(null);
      last.current = -1;
    },
  }).current;
  const pan = usePanGesture({
    minDistance: 0, // 누르자마자 (톡 눌러도 그 쪽으로)
    runOnJS: true,
    onActivate: (e) => api.seek(e.x),
    onUpdate: (e) => api.seek(e.x),
    onFinalize: () => api.done(),
  });
  const cur = Math.max(0, Math.min(count - 1, held ?? index));
  const pct = `${count > 1 ? (cur / (count - 1)) * 100 : 0}%` as const;
  return (
    <View pointerEvents="box-none" style={sx.wrap}>
      <View style={[floating(t), sx.bar]}>
        {/* 쪽 번호를 누르면 번호를 넣어 바로 가는 창 */}
        <Pressable
          onPress={onAskPage}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`쪽 번호로 가기 (지금 ${cur + 1}쪽, 전체 ${count}쪽)`}
          style={({ pressed }) => [sx.numBtn, { backgroundColor: pressed ? t.lineSoft : t.sunken }]}
        >
          <Text style={[sx.num, { color: held !== null ? t.accent : t.sub }]}>{`${cur + 1} / ${count}`}</Text>
        </Pressable>
        <GestureDetector gesture={pan}>
          <View
            collapsable={false}
            style={sx.hit}
            onLayout={(e) => {
              width.current = Math.max(1, e.nativeEvent.layout.width);
            }}
            accessibilityRole="adjustable"
            accessibilityLabel={`쪽 이동 막대: 지금 ${cur + 1}쪽, 전체 ${count}쪽`}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) => onSeek(Math.max(0, Math.min(count - 1, index + (e.nativeEvent.actionName === "increment" ? 1 : -1))))}
          >
            <View style={[sx.track, { backgroundColor: t.lineSoft }]} />
            <View style={[sx.fill, { width: pct, backgroundColor: t.accent }]} />
            <View style={[sx.thumb, { left: pct, backgroundColor: t.accent, borderColor: t.card }, held !== null && sx.thumbHeld]} />
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

const sx = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 14, alignItems: "center", zIndex: 20 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, width: "62%", minWidth: 280, maxWidth: 620, height: 44, borderRadius: 22, paddingLeft: 16, paddingRight: 22 },
  numBtn: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: "center", marginLeft: -8 },
  num: { minWidth: 62, textAlign: "center", fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  hit: { flex: 1, height: 44, justifyContent: "center" },
  track: { height: 4, borderRadius: 2 },
  fill: { position: "absolute", left: 0, height: 4, borderRadius: 2 },
  thumb: { position: "absolute", top: 13, width: 18, height: 18, marginLeft: -9, borderRadius: 9, borderWidth: 2 },
  thumbHeld: { top: 10, width: 24, height: 24, marginLeft: -12, borderRadius: 12 },
});
