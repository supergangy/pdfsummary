// 쪽 모아보기: 쪽마다 작은 그림(바탕 + 필기)을 격자로 보여 주고, 누르면 그 쪽으로 간다.
import { Canvas, Group, Image, Picture, Rect, useImage, type SkPath } from "@shopify/react-native-skia";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../ui";
import type { Ink, Notebook, Page } from "./model";
import { pageImage } from "./pageImage";
import { inkPicture, paperPicture } from "./render";

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
  const cols = Math.max(2, Math.min(8, Math.floor((width - 24) / 150)));
  const cellW = (width - 24 - (cols - 1) * 12) / cols;
  const list = useRef<FlatList<Page>>(null);
  const [onlyInk, setOnlyInk] = useState(false);
  const pages = useMemo(
    () => nb.pages.map((p, i) => ({ p, i })).filter(({ p }) => !onlyInk || (ink[p.id]?.length ?? 0) > 0),
    [nb.pages, ink, onlyInk],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, gap: 10, borderBottomWidth: 1, borderColor: t.line }}>
          <Text style={{ color: t.ink, fontWeight: "700", fontSize: 17, flex: 1 }}>쪽 모아보기 · {nb.pages.length}쪽</Text>
          <Pressable
            onPress={() => setOnlyInk(!onlyInk)}
            accessibilityRole="switch"
            accessibilityState={{ checked: onlyInk }}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: onlyInk ? t.accent : t.line, backgroundColor: onlyInk ? t.soft : t.card }}
          >
            <Text style={{ color: onlyInk ? t.accent : t.ink }}>필기한 쪽만</Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="쪽 모아보기 닫기" style={{ padding: 8 }}>
            <Text style={{ color: t.accent, fontSize: 16 }}>닫기</Text>
          </Pressable>
        </View>
        <FlatList
          ref={list as never}
          key={cols}
          data={pages}
          numColumns={cols}
          keyExtractor={(x) => x.p.id}
          contentContainerStyle={{ padding: 12, gap: 14 }}
          columnWrapperStyle={cols > 1 ? { gap: 12 } : undefined}
          initialNumToRender={cols * 4}
          windowSize={5}
          initialScrollIndex={onlyInk ? undefined : Math.max(0, Math.floor(current / cols) * cols) || undefined}
          getItemLayout={undefined}
          ListEmptyComponent={<Text style={{ color: t.muted, padding: 20 }}>필기한 쪽이 없어요.</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => onPick(item.i)} accessibilityRole="button" accessibilityLabel={`${item.i + 1}쪽으로`} style={{ width: cellW }}>
              <Thumb nbId={nb.id} page={item.p} ink={ink} pdfUri={pdfUri} width={cellW} active={item.i === current} />
              <Text style={{ color: item.i === current ? t.accent : t.muted, textAlign: "center", marginTop: 4, fontWeight: item.i === current ? "700" : "400" }}>
                {item.i + 1}
                {(ink[item.p.id]?.length ?? 0) > 0 ? " ✎" : ""}
              </Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const Thumb = memo(function Thumb({ nbId, page, ink, pdfUri, width, active }: { nbId: string; page: Page; ink: Ink; pdfUri: string | null; width: number; active: boolean }) {
  const t = useTheme();
  const h = (width * page.h) / page.w;
  const s = width / page.w;
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
  const cache = useRef(new Map<string, SkPath | null>());
  const pic = useMemo(() => (strokes?.length ? inkPicture(strokes, new Set(), page.w, page.h, cache.current) : null), [strokes, page.w, page.h]);
  const paper = useMemo(() => paperPicture(page), [page]);
  return (
    <View style={{ width, height: h, borderRadius: 4, overflow: "hidden", borderWidth: active ? 3 : 1, borderColor: active ? t.accent : t.line, backgroundColor: "#fff" }}>
      <Canvas style={{ width: width - (active ? 6 : 2), height: h - (active ? 6 : 2) }}>
        <Group transform={[{ scale: s }]}>
          <Rect x={0} y={0} width={page.w} height={page.h} color="#FFFFFF" />
          {img ? <Image image={img} x={0} y={0} width={page.w} height={page.h} fit="fill" /> : null}
          {paper ? <Picture picture={paper} /> : null}
          {pic ? <Picture picture={pic} /> : null}
        </Group>
      </Canvas>
    </View>
  );
});
