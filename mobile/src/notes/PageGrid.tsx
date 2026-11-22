// 쪽 모아보기: 쪽마다 작은 그림(바탕 + 필기)을 격자로 보여 주고, 누르면 그 쪽으로 간다.
import { Canvas, Group, Image, Picture, Rect, useImage } from "@shopify/react-native-skia";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, radius, type, useTheme } from "../ui";
import type { Ink, Notebook, Page } from "./model";
import { GRID_LABEL_H, GRID_PAD, GRID_ROW_GAP, gridRow, gridRows } from "./objects-grid";
import { pageImage } from "./pageImage";
import { inkPicture, paperPicture, type PathCache } from "./render";

type Props = {
  visible: boolean;
  nb: Notebook;
  ink: Ink;
  pdfUri: string | null;
  current: number;
  onPick: (index: number) => void;
  onClose: () => void;
};

export function PageGrid({ visible, nb, ink, pdfUri, current, onPick, onClose }: Props) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  // 넓은 화면은 가장자리 여백을 넉넉하게 (위아래 여백은 줄 계산과 맞춰 GRID_PAD 그대로)
  const padX = width >= 700 ? 24 : 16;
  const colGap = width >= 700 ? 16 : 12;
  const cols = Math.max(2, Math.min(8, Math.floor((width - padX * 2 + colGap) / (150 + colGap))));
  const cellW = (width - padX * 2 - (cols - 1) * colGap) / cols;
  const list = useRef<FlatList<Page>>(null);
  const [onlyInk, setOnlyInk] = useState(false);
  const pages = useMemo(
    () => nb.pages.map((p, i) => ({ p, i })).filter(({ p }) => !onlyInk || (ink[p.id]?.length ?? 0) > 0),
    [nb.pages, ink, onlyInk],
  );
  // 줄마다 높이와 자리를 미리 셈해 둔다 → 목록이 지금 보던 쪽의 줄로 바로 갈 수 있다
  const rows = useMemo(() => gridRows(pages.map((x) => x.p), cols, cellW), [pages, cols, cellW]);
  // 열 때마다(그리고 칸 수가 바뀔 때마다) 한 번, 지금 보던 쪽이 있는 줄로 옮긴다.
  // (initialScrollIndex는 쓰지 않는다: 줄 번호가 어긋나거나 굴릴 수 없는 짧은 목록이면 위쪽 줄이 끝내 안 그려진다)
  const jumped = useRef<number | null>(null);
  useEffect(() => {
    if (!visible) jumped.current = null;
  }, [visible]);
  const jumpToCurrent = (_w: number, h: number) => {
    if (h <= 0 || jumped.current === cols) return;
    jumped.current = cols;
    const at = pages.findIndex((x) => x.i === current);
    const row = at < 0 ? undefined : rows[gridRow(at, cols)];
    if (row && row.offset > GRID_PAD) list.current?.scrollToOffset({ offset: row.offset - GRID_PAD, animated: false });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.head, { paddingHorizontal: padX, borderColor: t.lineSoft }]}>
          <View style={s.titleRow}>
            <Text style={[type.title, { color: t.ink }]} numberOfLines={1}>쪽 모아보기</Text>
            <Text style={[type.caption, { color: t.muted }]}>{nb.pages.length}쪽</Text>
          </View>
          {/* 켜면 검은 알약 (어두운 모드는 흰 알약) */}
          <Pressable
            onPress={() => setOnlyInk(!onlyInk)}
            accessibilityRole="switch"
            accessibilityState={{ checked: onlyInk }}
            style={({ pressed }) => [s.toggle, { backgroundColor: onlyInk ? t.ink : t.sunken, opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={[s.toggleText, { color: onlyInk ? t.bg : t.sub, fontWeight: onlyInk ? "600" : "500" }]}>필기한 쪽만</Text>
          </Pressable>
          <Button small label="닫기" accessibilityLabel="쪽 모아보기 닫기" onPress={onClose} />
        </View>
        <FlatList
          ref={list as never}
          key={cols}
          data={pages}
          numColumns={cols}
          keyExtractor={(x) => x.p.id}
          contentContainerStyle={{ paddingHorizontal: padX, paddingTop: GRID_PAD, paddingBottom: 32, gap: GRID_ROW_GAP }}
          columnWrapperStyle={cols > 1 ? { gap: colGap } : undefined}
          initialNumToRender={4} // 여러 칸 목록은 '줄' 단위로 센다 (4줄)
          windowSize={5}
          getItemLayout={(_data, index) => ({ length: rows[index]?.length ?? 0, offset: rows[index]?.offset ?? 0, index })}
          onContentSizeChange={jumpToCurrent}
          ListEmptyComponent={<Text style={[type.body, s.empty, { color: t.muted }]}>필기한 쪽이 없어요.</Text>}
          renderItem={({ item }) => {
            const on = item.i === current;
            const inked = (ink[item.p.id]?.length ?? 0) > 0;
            return (
              <Pressable onPress={() => onPick(item.i)} accessibilityRole="button" accessibilityLabel={`${item.i + 1}쪽으로`} style={{ width: cellW }}>
                <Thumb nbId={nb.id} page={item.p} ink={ink} pdfUri={pdfUri} width={cellW} active={on} />
                {/* 쪽 번호 줄 (높이는 줄 계산과 같게 고정). 필기가 있는 쪽은 번호 옆에 작은 점 */}
                <View style={s.label}>
                  <Text numberOfLines={1} style={[type.caption, { color: on ? t.ink : t.muted, fontWeight: on ? "700" : "400" }]}>
                    {item.i + 1}
                  </Text>
                  {inked && <View style={[s.inkDot, { backgroundColor: on ? t.ink : t.muted }]} />}
                </View>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const Thumb = memo(function Thumb({ nbId, page, ink, pdfUri, width, active }: { nbId: string; page: Page; ink: Ink; pdfUri: string | null; width: number; active: boolean }) {
  const t = useTheme();
  const h = (width * page.h) / page.w;
  const [bg, setBg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (pdfUri && page.pdf !== undefined) {
      pageImage(nbId, pdfUri, page.pdf, 512).then((u) => alive && setBg(u)).catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [nbId, pdfUri, page.pdf]);
  const img = useImage(bg ?? undefined);
  const strokes = ink[page.id];
  const cache = useRef<PathCache>(new WeakMap());
  const pic = useMemo(() => (strokes?.length ? inkPicture(strokes, new Set(), page.w, page.h, cache.current) : null), [strokes, page.w, page.h]);
  const paper = useMemo(() => paperPicture(page), [page]);
  // 지금 보던 쪽은 바깥에 검은(어두운 모드는 흰) 테두리를 두르고 종이와 사이를 조금 띄운다
  const inset = active ? RING + RING_GAP : 1;
  const innerW = width - inset * 2;
  const innerH = h - inset * 2;
  const sc = Math.min(innerW / page.w, innerH / page.h);
  return (
    <View style={[s.thumb, { width, height: h }, active ? { borderWidth: RING, borderColor: t.ink, padding: RING_GAP, backgroundColor: t.bg } : { borderColor: t.line }]}>
      <View style={[s.paper, active && { borderRadius: radius.sm - inset }]}>
        <Canvas style={{ width: innerW, height: innerH }}>
          <Group transform={[{ scale: sc }]}>
            <Rect x={0} y={0} width={page.w} height={page.h} color="#FFFFFF" />
            {img ? <Image image={img} x={0} y={0} width={page.w} height={page.h} fit="fill" /> : null}
            {paper ? <Picture picture={paper} /> : null}
            {pic ? <Picture picture={pic} /> : null}
          </Group>
        </Canvas>
      </View>
    </View>
  );
});

const RING = 2; // 지금 쪽 테두리 두께
const RING_GAP = 2; // 테두리와 종이 사이

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1 },
  titleRow: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8 },
  toggle: { borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14 },
  toggleText: { fontSize: 14, letterSpacing: -0.2 },
  empty: { paddingVertical: 48, textAlign: "center" },
  label: { height: GRID_LABEL_H - 4, marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  inkDot: { width: 5, height: 5, borderRadius: 2.5 },
  // 쪽 그림은 종이라서 어두운 모드에서도 흰 바탕
  thumb: { borderRadius: radius.sm, borderWidth: 1, overflow: "hidden", backgroundColor: "#FFFFFF" },
  paper: { flex: 1, overflow: "hidden", backgroundColor: "#FFFFFF" },
});
