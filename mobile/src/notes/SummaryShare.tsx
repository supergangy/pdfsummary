// 요약 화면 위의 '복사'·'공유' 단추. 공유를 누르면 고르는 창: 글로 · PDF로 · 웹페이지(HTML)로 (+ 화면마다 더 있는 것)
import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Button, floating, radius, type, useTheme } from "../ui";
import { copyText, shareHtml, shareHtmlAsPdf, shareText } from "./summaryExport";

export type ShareExtra = { label: string; hint: string; run: () => Promise<void> };

export function SummaryShare({ name, text, html, extra = [], disabled, onMessage }: {
  name: string; // 파일·공유 제목 (예: '생물 요약')
  text: () => Promise<string> | string;
  html: () => Promise<string> | string;
  extra?: ShareExtra[];
  disabled?: boolean;
  onMessage: (msg: string, bad?: boolean) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, done?: string) => {
    setOpen(false);
    setBusy(true);
    try {
      await fn();
      if (done) onMessage(done);
    } catch (e) {
      onMessage(`보내지 못했어요: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  const options: ShareExtra[] = [
    { label: "글로 보내기", hint: "카톡·메모·삼성 노트 등에 글 그대로 (표시한 부분은 【 】)", run: async () => shareText(await text(), name) },
    {
      label: "PDF로 보내기",
      hint: Platform.OS === "web" ? "인쇄 창이 열리면 'PDF로 저장'을 고르세요" : "보이는 모습 그대로 PDF 파일로",
      run: async () => shareHtmlAsPdf(await html(), name),
    },
    { label: "웹페이지(HTML)로 보내기", hint: "브라우저로 여는 파일", run: async () => shareHtml(await html(), name) },
    ...extra,
  ];
  return (
    <>
      <Button small label="복사" accessibilityLabel="요약 글 복사" disabled={disabled || busy} onPress={() => void run(async () => copyText(await text()), "요약 글을 복사했어요. 메모·카톡에 붙여 넣으면 돼요.")} />
      <Button small label="공유" accessibilityLabel="요약 공유" disabled={disabled} busy={busy} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[sx.back, { backgroundColor: t.dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.32)" }]} onPress={() => setOpen(false)} accessibilityLabel="닫기">
          <Pressable style={[floating(t), sx.sheet]} onPress={() => {}}>
            <Text style={[type.title, { color: t.ink, marginBottom: 8 }]}>요약 보내기</Text>
            {options.map((o) => (
              <Pressable
                key={o.label}
                onPress={() => void run(o.run)}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                style={({ pressed }) => [sx.row, { backgroundColor: pressed ? t.sunken : "transparent", borderColor: t.lineSoft }]}
              >
                <Text style={[type.body, { color: t.ink, fontWeight: "600" }]}>{o.label}</Text>
                <Text style={[type.caption, { color: t.muted }]}>{o.hint}</Text>
              </Pressable>
            ))}
            <View style={sx.foot}>
              <Button label="닫기" onPress={() => setOpen(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const sx = StyleSheet.create({
  back: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  sheet: { width: "100%", maxWidth: 420, borderRadius: radius.lg, padding: 20, gap: 4 },
  row: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  foot: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
});
