// 도구 설정 창: 펜 종류·굵기·선 모양·색 / 형광펜 굵기·투명도·직선·글줄 맞추기 / 지우개 / 올가미.
// 도구 모음에서 이미 고른 도구를 한 번 더 누르면 열린다.
import { Canvas, Group, Picture } from "@shopify/react-native-skia";
import { useEffect, useMemo, useRef } from "react";
import { Modal, Platform, Pressable, ScrollView, Switch, Text, useWindowDimensions, View } from "react-native";

import { useTheme } from "../ui";
import { previewPts, previewScale, swatchEdge } from "./editor-logic";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_OPACITY_STEPS,
  HIGHLIGHT_WIDTH_STEPS,
  PEN_COLORS,
  PEN_WIDTH_STEPS,
  PENS,
  type LineDash,
  type Stroke,
} from "./model";
import type { SwapTarget } from "./editor-logic";
import type { Prefs } from "./prefs";
import { inkPicture, type PathCache } from "./render";

type Props = {
  open: boolean;
  prefs: Prefs;
  setP: (patch: Partial<Prefs>) => void;
  onClearPage: () => void;
  onClose: () => void;
  /** 창을 띄울 자리 (화면 기준): 도구 모음 바로 밑, 누른 도구 단추의 왼쪽 끝 */
  at?: { top: number; left: number } | null;
  /** 쪽이 지금 화면에 보이는 배율 (1pt가 화면 몇 칸인지). 펜 견본을 실제로 그어지는 굵기로 보여 주려고 */
  viewScale?: number;
};

const nearest = (steps: number[], v: number) => steps.reduce((a, b, i) => (Math.abs(b - v) < Math.abs(steps[a] - v) ? i : a), 0);

export function ToolPanel({ open, prefs, setP, onClearPage, onClose, at, viewScale }: Props) {
  const t = useTheme();
  const win = useWindowDimensions();
  const tool = prefs.tool;
  const title = tool === "pen" ? "펜" : tool === "highlighter" ? "형광펜" : tool === "eraser" ? "지우개" : tool === "lasso" ? "올가미 (고르기)" : "글상자";
  // 도구 모음 바로 밑에, 화면 밖으로 나가지 않게
  const width = Math.min(360, win.width * 0.94);
  const top = at?.top ?? 96;
  const left = Math.max(8, Math.min(at?.left ?? 12, win.width - width - 8));
  // 도구 단추를 빠르게 두 번 누르면 두 번째 누름이 '창 바깥'으로 쳐져 뜨자마자 닫혔다 → 막 열렸을 때의 바깥 누름은 넘긴다
  const openedAt = useRef(0);
  useEffect(() => {
    if (open) openedAt.current = Date.now();
  }, [open]);
  const closeOutside = () => {
    if (Date.now() - openedAt.current > 400) onClose();
  };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.18)" }} onPress={closeOutside} accessibilityLabel="도구 설정 닫기">
        <Pressable
          onPress={() => {}}
          accessibilityLabel={`${title} 설정`}
          style={{ position: "absolute", top, left, width, maxHeight: Math.max(200, win.height - top - 16), backgroundColor: t.card, borderRadius: 18, borderWidth: 1, borderColor: t.line, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 14, elevation: 8 }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: t.ink, fontWeight: "800", fontSize: 17, flex: 1 }}>{title}</Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" hitSlop={8}>
                <Text style={{ color: t.muted, fontSize: 20 }}>✕</Text>
              </Pressable>
            </View>
            {tool === "pen" && <PenOptions prefs={prefs} setP={setP} viewScale={viewScale} />}
            {tool === "highlighter" && <HighlighterOptions prefs={prefs} setP={setP} />}
            {tool === "eraser" && <EraserOptions prefs={prefs} setP={setP} onClearPage={onClearPage} />}
            {tool === "lasso" && <LassoOptions prefs={prefs} setP={setP} />}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── 펜 ──────────────────────────────────────────────────────────────

function PenOptions({ prefs, setP, viewScale }: { prefs: Prefs; setP: Props["setP"]; viewScale?: number }) {
  const t = useTheme();
  return (
    <>
      <Preview prefs={prefs} viewScale={viewScale} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="펜 종류">
        {PENS.map((p) => (
          <Chip key={p.id} label={p.label} on={prefs.penBrush === p.id} onPress={() => setP({ penBrush: p.id })} hint={p.hint} />
        ))}
      </View>
      <StepSlider label="굵기" steps={PEN_WIDTH_STEPS} index={nearest(PEN_WIDTH_STEPS, prefs.penWidth)} onChange={(i) => setP({ penWidth: PEN_WIDTH_STEPS[i] })} />
      <Text style={{ color: t.muted, fontSize: 13 }}>선 모양</Text>
      <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="선 모양">
        {(["solid", "dash", "dot"] as LineDash[]).map((d) => (
          <DashChip key={d} dash={d} on={prefs.penDash === d} onPress={() => setP({ penDash: d })} />
        ))}
      </View>
      <Colors colors={PEN_COLORS} value={prefs.penColor} onPick={(c) => setP({ penColor: c })} />
      <Toggle label="도형 펴기" hint="선·사각형·원·삼각형을 반듯하게" value={prefs.shapes} onChange={(v) => setP({ shapes: v })} />
      <PenSwapOptions prefs={prefs} setP={setP} />
    </>
  );
}

const SWAPS: { v: SwapTarget; label: string }[] = [
  { v: "highlighter", label: "형광펜" },
  { v: "eraser", label: "지우개" },
  { v: "lasso", label: "올가미" },
  { v: "favorite", label: "즐겨찾는 펜" },
  { v: "off", label: "끄기" },
];

/** S펜 옆 단추 두 번: 바꿀 도구 고르기, 즐겨찾는 펜 등록 */
function PenSwapOptions({ prefs, setP }: { prefs: Prefs; setP: Props["setP"] }) {
  const t = useTheme();
  const fav = prefs.favorite;
  const favLabel = fav ? `${PENS.find((x) => x.id === fav.penBrush)?.label ?? "펜"} · 굵기 ${fav.penWidth}` : "아직 등록하지 않았어요";
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: t.line, paddingTop: 12 }}>
      <Text style={{ color: t.ink, fontWeight: "600" }}>S펜 단추를 두 번 누르면</Text>
      <Text style={{ color: t.muted, fontSize: 12.5 }}>펜을 화면에서 살짝 띄운 채 옆 단추를 빠르게 두 번. 한 번 더 두 번 누르면 원래대로 돌아와요.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="두 번 누르면 바꿀 도구">
        {SWAPS.map((s) => (
          <Chip key={s.v} label={s.label} on={prefs.swapTool === s.v} onPress={() => setP({ swapTool: s.v })} />
        ))}
      </View>
      {prefs.swapTool === "favorite" && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {fav && <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: fav.penColor, borderWidth: 1, borderColor: t.line }} />}
          <Text style={{ color: fav ? t.ink : t.muted, flex: 1 }}>{favLabel}</Text>
          <Pressable
            onPress={() => setP({ favorite: { penBrush: prefs.penBrush, penColor: prefs.penColor, penWidth: prefs.penWidth, penDash: prefs.penDash } })}
            accessibilityRole="button"
            accessibilityLabel="지금 펜을 즐겨찾는 펜으로 등록"
            style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: t.line, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ color: t.ink, fontWeight: "600" }}>지금 펜을 등록</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** 지금 설정으로 그은 견본 획 — 쪽이 화면에 보이는 배율로 키워서, 실제로 그어지는 굵기와 같게 */
function Preview({ prefs, viewScale }: { prefs: Prefs; viewScale?: number }) {
  const t = useTheme();
  const cache = useRef<PathCache>(new WeakMap());
  const scale = previewScale(viewScale);
  const pic = useMemo(() => {
    const s: Stroke = { id: "preview", tool: "pen", color: prefs.penColor === "#FFFFFF" ? "#999999" : prefs.penColor, width: prefs.penWidth, pts: previewPts(scale), brush: prefs.penBrush, dash: prefs.penDash };
    return inkPicture([s], new Set(), 330, 64, cache.current);
  }, [prefs.penColor, prefs.penWidth, prefs.penBrush, prefs.penDash, scale]);
  return (
    <View style={{ height: 64, borderRadius: 10, overflow: "hidden", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: t.line }} accessibilityLabel="펜 견본">
      <Canvas style={{ width: 330, height: 64 }}>
        <Group transform={[{ scale }]}>
          <Picture picture={pic} />
        </Group>
      </Canvas>
    </View>
  );
}

// ── 형광펜 ──────────────────────────────────────────────────────────

function HighlighterOptions({ prefs, setP }: { prefs: Prefs; setP: Props["setP"] }) {
  const t = useTheme();
  return (
    <>
      <View style={{ height: 40, borderRadius: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: t.line, justifyContent: "center", paddingHorizontal: 14 }}>
        <View style={{ position: "absolute", left: 10, right: 10, height: Math.min(30, prefs.hlWidth), backgroundColor: prefs.hlColor, opacity: prefs.hlOpacity }} />
        <Text style={{ color: "#202328" }}>형광펜 견본 글자</Text>
      </View>
      <StepSlider label="굵기" steps={HIGHLIGHT_WIDTH_STEPS} index={nearest(HIGHLIGHT_WIDTH_STEPS, prefs.hlWidth)} onChange={(i) => setP({ hlWidth: HIGHLIGHT_WIDTH_STEPS[i] })} />
      <StepSlider
        label="투명도"
        steps={HIGHLIGHT_OPACITY_STEPS}
        index={nearest(HIGHLIGHT_OPACITY_STEPS, prefs.hlOpacity)}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(i) => setP({ hlOpacity: HIGHLIGHT_OPACITY_STEPS[i] })}
      />
      <Toggle label="직선" hint="가로로 그으면 곧은 선으로" value={prefs.straight} onChange={(v) => setP({ straight: v })} />
      <Toggle label="글자 크기에 맞춰 두께 조절" hint="PDF 쪽에서 칠한 글줄 높이·글자 끝에 맞춰요" value={prefs.hlFit} onChange={(v) => setP({ hlFit: v })} />
      <Colors colors={HIGHLIGHT_COLORS} value={prefs.hlColor} onPick={(c) => setP({ hlColor: c })} />
    </>
  );
}

// ── 지우개 ──────────────────────────────────────────────────────────

function EraserOptions({ prefs, setP, onClearPage }: { prefs: Prefs; setP: Props["setP"]; onClearPage: () => void }) {
  const t = useTheme();
  const sizes = [6, 9, 12, 16, 22, 30, 40];
  return (
    <>
      <View style={{ gap: 4 }} accessibilityRole="radiogroup" accessibilityLabel="지우개 종류">
        <Radio label="획 지우개" hint="닿은 획을 통째로" on={prefs.eraserMode === "stroke"} onPress={() => setP({ eraserMode: "stroke" })} />
        <Radio label="영역 지우개" hint="문지른 자리만" on={prefs.eraserMode === "area"} onPress={() => setP({ eraserMode: "area" })} />
      </View>
      <StepSlider label="크기" steps={sizes} index={nearest(sizes, prefs.eraserSize)} onChange={(i) => setP({ eraserSize: sizes[i] })} format={(v) => `${v}`} />
      <Toggle label="형광펜만 지우기" value={prefs.eraserHlOnly} onChange={(v) => setP({ eraserHlOnly: v })} />
      <Text style={{ color: t.muted, fontSize: 12.5 }}>S펜 옆 단추를 누른 채 쓰면 언제든 이 지우개가 돼요.</Text>
      <Pressable
        onPress={onClearPage}
        accessibilityRole="button"
        accessibilityLabel="이 쪽 손글씨 모두 지우기"
        style={({ pressed }) => ({ paddingVertical: 12, alignItems: "center", borderTopWidth: 1, borderColor: t.line, marginTop: 4, opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={{ color: t.bad, fontWeight: "700" }}>이 쪽 손글씨 모두 지우기</Text>
      </Pressable>
    </>
  );
}

// ── 올가미 ──────────────────────────────────────────────────────────

function LassoOptions({ prefs, setP }: { prefs: Prefs; setP: Props["setP"] }) {
  return (
    <>
      <View style={{ gap: 4 }} accessibilityRole="radiogroup" accessibilityLabel="올가미 모양">
        <Radio label="자유형" on={prefs.lassoMode === "free"} onPress={() => setP({ lassoMode: "free" })} />
        <Radio label="사각형" on={prefs.lassoMode === "rect"} onPress={() => setP({ lassoMode: "rect" })} />
      </View>
      <Toggle label="부분 선택된 개체 포함" hint="조금이라도 걸친 획도 고르기" value={prefs.lassoPartial} onChange={(v) => setP({ lassoPartial: v })} />
    </>
  );
}

// ── 작은 부품 ────────────────────────────────────────────────────────

function Chip({ label, on, onPress, hint }: { label: string; on: boolean; onPress: () => void; hint?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: on ? t.accent : t.line, backgroundColor: on ? t.soft : t.card }}
    >
      <Text style={{ color: on ? t.accent : t.ink, fontWeight: on ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}

function DashChip({ dash, on, onPress }: { dash: LineDash; on: boolean; onPress: () => void }) {
  const t = useTheme();
  const label = dash === "solid" ? "실선" : dash === "dash" ? "파선" : "점선";
  const seg = dash === "solid" ? [44] : dash === "dash" ? [12, 12, 12] : [4, 4, 4, 4, 4, 4];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={{ flex: 1, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: dash === "solid" ? 0 : 5, borderWidth: 1, borderColor: on ? t.accent : t.line, backgroundColor: on ? t.soft : t.card }}
    >
      {seg.map((w, i) => (
        <View key={i} style={{ width: w, height: 3, borderRadius: 2, backgroundColor: on ? t.accent : t.ink }} />
      ))}
    </Pressable>
  );
}

function Colors({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  const t = useTheme();
  const edge = swatchEdge(t.card, "rgba(0,0,0,0.18)"); // 어두운 모드에서도 검정 단추가 보이게
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="색">
      {colors.map((c) => (
        <Pressable
          key={c}
          onPress={() => onPick(c)}
          accessibilityRole="radio"
          accessibilityLabel={`색 ${c}`}
          accessibilityState={{ selected: c === value }}
          style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: c === value ? 2 : 0, borderColor: t.accent }}
        >
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: 1, borderColor: edge }} />
        </Pressable>
      ))}
    </View>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.ink }}>{label}</Text>
        {!!hint && <Text style={{ color: t.muted, fontSize: 12 }}>{hint}</Text>}
      </View>
      {/* 웹에서는 Switch 자체도 눌리므로 바깥 Pressable이 받게 */}
      <View pointerEvents={Platform.OS === "web" ? "none" : "auto"}>
        <Switch value={value} onValueChange={onChange} />
      </View>
    </Pressable>
  );
}

function Radio({ label, hint, on, onPress }: { label: string; hint?: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: on }} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? t.accent : t.muted, alignItems: "center", justifyContent: "center" }}>
        {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.accent }} />}
      </View>
      <Text style={{ color: t.ink }}>{label}</Text>
      {!!hint && <Text style={{ color: t.muted, fontSize: 12 }}>{hint}</Text>}
    </Pressable>
  );
}

/** − ●●●○○ + 단계 고르기 */
function StepSlider({ label, steps, index, onChange, format }: { label: string; steps: number[]; index: number; onChange: (i: number) => void; format?: (v: number) => string }) {
  const t = useTheme();
  const show = format ?? ((v: number) => String(v));
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {label} <Text style={{ color: t.ink, fontWeight: "700" }}>{show(steps[index])}</Text>
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: show(steps[index]) }}>
        <Pressable onPress={() => onChange(Math.max(0, index - 1))} accessibilityRole="button" accessibilityLabel={`${label} 줄이기`} hitSlop={6} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: t.ink, fontSize: 22 }}>−</Text>
        </Pressable>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 28, backgroundColor: t.soft, borderRadius: 14, paddingHorizontal: 8 }}>
          {steps.map((v, i) => (
            <Pressable key={v} onPress={() => onChange(i)} accessibilityRole="button" accessibilityLabel={`${label} ${show(v)}`} hitSlop={4} style={{ width: 18, height: 28, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: i === index ? 16 : 6, height: i === index ? 16 : 6, borderRadius: 8, backgroundColor: i <= index ? t.accent : t.muted, opacity: i <= index ? 1 : 0.5 }} />
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => onChange(Math.min(steps.length - 1, index + 1))} accessibilityRole="button" accessibilityLabel={`${label} 늘리기`} hitSlop={6} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: t.ink, fontSize: 22 }}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}
