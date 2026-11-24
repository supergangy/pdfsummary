// 노트에서 찾기 (Ctrl+F 또는 ⋯ 메뉴): PDF 쪽 글과 글상자에서 찾는 말이 나오는 쪽을 보여 주고, 누르면 그 쪽으로
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { pagePlainText } from "../../modules/pdf-pages";
import { Button, floating, radius, styles as ui, type, useTheme } from "../ui";
import { countInText, findInText, type Hit } from "./findText";
import type { Ink, Notebook } from "./model";

type Row = { page: number; count: number; hit: Hit };

export function FindPanel({ open, nb, ink, pdfUri, onGo, onClose }: {
  open: boolean;
  nb: Notebook;
  ink: Ink;
  pdfUri: string | null;
  onGo: (page: number) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const run = useRef(0);
  const texts = useRef(new Map<string, string>()); // 쪽 id → 글 (한 번 읽은 쪽은 다시 안 읽는다)

  // 노트가 바뀌면 읽어 둔 글을 버린다
  useEffect(() => {
    texts.current.clear();
  }, [nb.id, pdfUri]);

  const search = async (query: string) => {
    const my = ++run.current;
    setRows([]);
    if (!query.trim()) return setBusy(null);
    const found: Row[] = [];
    for (let i = 0; i < nb.pages.length; i++) {
      if (run.current !== my) return;
      const p = nb.pages[i];
      let text = texts.current.get(p.id);
      if (text === undefined) {
        const pdf = p.pdf !== undefined && pdfUri ? (await pagePlainText(pdfUri, p.pdf)) ?? "" : "";
        // PDF 글이 바뀌지 않으니 그것만 기억하고, 글상자는 매번 지금 것으로
        text = pdf;
        texts.current.set(p.id, pdf);
      }
      const boxes = (ink[p.id] ?? []).filter((s) => s.tool === "text" && s.text).map((s) => s.text).join("\n");
      const all = boxes ? `${text}\n${boxes}` : text;
      const n = countInText(all, query);
      if (n) {
        found.push({ page: i, count: n, hit: findInText(all, query, 1)[0] });
        if (run.current === my) setRows([...found]);
      }
      if (i % 8 === 0 || i === nb.pages.length - 1) setBusy({ done: i + 1, total: nb.pages.length });
    }
    if (run.current === my) setBusy(null);
  };

  // 입력이 멈추면 찾는다
  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => void search(q), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);
  useEffect(() => {
    if (!open) run.current++; // 닫으면 하던 찾기를 멈춘다
  }, [open]);

  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[sx.back, { backgroundColor: t.dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.2)" }]} onPress={onClose}>
        <Pressable style={[floating(t), sx.panel]} onPress={() => {}}>
          <View style={sx.head}>
            <TextInput
              value={q}
              onChangeText={setQ}
              autoFocus
              returnKeyType="search"
              onSubmitEditing={() => void search(q)}
              placeholder="노트에서 찾기 (PDF 글·글상자)"
              placeholderTextColor={t.muted}
              accessibilityLabel="찾을 말"
              style={[ui.input, { flex: 1, borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
            />
            <Button label="닫기" onPress={onClose} />
          </View>
          <View style={sx.status}>
            {busy && <ActivityIndicator size="small" color={t.muted} />}
            <Text style={[type.caption, { color: t.sub }]}>
              {!q.trim() ? "찾을 말을 넣으세요. 띄어쓰기는 가리지 않아요." : busy ? `쪽을 살펴보는 중… ${busy.done}/${busy.total}쪽 · 지금까지 ${rows.length}쪽에서 ${total}곳` : rows.length ? `${rows.length}쪽에서 ${total}곳` : "찾지 못했어요. (그림만 있는 쪽은 글자를 읽을 수 없어 찾지 못해요)"}
            </Text>
          </View>
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {rows.map((r) => (
              <Pressable
                key={r.page}
                onPress={() => onGo(r.page)}
                accessibilityRole="button"
                accessibilityLabel={`${r.page + 1}쪽으로 (${r.count}곳)`}
                style={({ pressed }) => [sx.row, { borderColor: t.lineSoft, backgroundColor: pressed ? t.sunken : "transparent" }]}
              >
                <Text style={[type.label, { color: t.ink, minWidth: 56 }]}>{`${r.page + 1}쪽`}</Text>
                <Text style={[type.caption, { color: t.sub, flex: 1 }]} numberOfLines={2}>
                  {r.hit.before}
                  <Text style={{ backgroundColor: "#FFE14D88", color: t.ink, fontWeight: "700" }}>{r.hit.mark}</Text>
                  {r.hit.after}
                </Text>
                {r.count > 1 && <Text style={[type.caption, { color: t.muted }]}>{`${r.count}곳`}</Text>}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const sx = StyleSheet.create({
  back: { flex: 1, alignItems: "center", paddingTop: 64, paddingHorizontal: 16 },
  panel: { width: "100%", maxWidth: 640, borderRadius: radius.lg, padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  status: { flexDirection: "row", alignItems: "center", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth },
});
