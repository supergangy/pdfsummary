// 화면 부품과 색 (밝은·어두운 모드).
// 모던 미니멀: 흰 바탕과 넉넉한 여백, 회색 단계로 위계를 나누고, 색(강조색)은 가장 중요한 단추 하나에만.
// 모서리는 은근히 둥글게(8·12·16), 그림자·효과는 창처럼 떠 있는 것에만 아주 옅게. 제목은 크고 굵게.
import { createContext, useContext, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

export type Theme = {
  dark: boolean;
  bg: string; // 화면 바탕
  card: string; // 카드·창 바탕
  sunken: string; // 살짝 들어간 바탕 (칩·입력 칸·꺼진 단추)
  ink: string; // 본문 글
  sub: string; // 조금 옅은 글 (단추 글, 보조 제목)
  muted: string; // 옅은 글 (설명, 자리 표시)
  line: string; // 테두리
  lineSoft: string; // 아주 옅은 구분선
  accent: string; // 강조색: 화면마다 가장 중요한 단추 하나에만
  accentInk: string; // 강조색 위의 글
  soft: string; // 강조색을 아주 옅게 (알림 바탕 등)
  canvas: string; // 필기 화면에서 쪽 둘레
  ok: string;
  bad: string;
  warn: string;
};

export const LIGHT: Theme = {
  dark: false,
  bg: "#FFFFFF", card: "#FFFFFF", sunken: "#F5F5F5", ink: "#212121", sub: "#424242", muted: "#757575",
  line: "#E0E0E0", lineSoft: "#EEEEEE", accent: "#6A3DF5", accentInk: "#FFFFFF", soft: "#F3EFFF", canvas: "#F2F2F2",
  ok: "#1E8E3E", bad: "#D93025", warn: "#B26A00",
};
export const DARK: Theme = {
  dark: true,
  bg: "#121212", card: "#1C1C1C", sunken: "#262626", ink: "#F2F2F2", sub: "#D0D0D0", muted: "#9E9E9E",
  line: "#333333", lineSoft: "#2A2A2A", accent: "#8F6BFF", accentInk: "#FFFFFF", soft: "#2A2342", canvas: "#0B0B0B",
  ok: "#5BC283", bad: "#FF7A6E", warn: "#F2B35B",
};

export const ThemeContext = createContext<Theme>(LIGHT);
export const useTheme = () => useContext(ThemeContext);

/** 화면 밝기: 밝게(기본) · 어둡게 · 기기 설정 따르기 */
export type ThemeMode = "light" | "dark" | "system";
export const ThemeModeContext = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>({ mode: "light", setMode: () => {} });
export const useThemeMode = () => useContext(ThemeModeContext);

/** 글자 크기 단계 (색은 따로) */
export const type = {
  display: { fontSize: 28, lineHeight: 36, fontWeight: "700", letterSpacing: -0.6 },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "700", letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: "700", letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 19 },
  small: { fontSize: 12, lineHeight: 16 },
} satisfies Record<string, TextStyle>;

/** 모서리 둥글기 */
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };

/** 떠 있는 창(설정 창·메뉴·알림)의 아주 옅은 그림자 */
export const floating = (t: Theme): ViewStyle => ({
  backgroundColor: t.card,
  borderWidth: 1,
  borderColor: t.lineSoft,
  shadowColor: "#000",
  shadowOpacity: t.dark ? 0.4 : 0.08,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 8 },
  elevation: 6,
});

/** 화면 맨 위 큰 제목과 한 줄 설명 */
export function ScreenTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[type.display, { color: t.ink }]} accessibilityRole="header">{title}</Text>
        {!!sub && <Text style={[type.body, { color: t.muted }]}>{sub}</Text>}
      </View>
      {right}
    </View>
  );
}

export function Card({ step, title, children, right }: { step?: number; title: string; children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.lineSoft }]}>
      <View style={styles.cardHead}>
        {step != null && (
          <View style={[styles.step, { backgroundColor: t.ink }]}>
            <Text style={{ color: t.bg, fontSize: 12, fontWeight: "700" }}>{step}</Text>
          </View>
        )}
        <Text style={[type.heading, { color: t.ink }]}>{title}</Text>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

export function Button({
  label, onPress, kind = "plain", disabled, busy, style, accessibilityLabel, small,
}: {
  label: string;
  onPress: () => void;
  /** primary = 강조색(화면마다 하나), plain = 흰 바탕 테두리, dark = 검은 바탕, link = 글자만 */
  kind?: "plain" | "primary" | "dark" | "link";
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  small?: boolean;
}) {
  const t = useTheme();
  if (kind === "link") {
    return (
      <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} hitSlop={8}>
        <Text style={[type.label, { color: disabled ? t.muted : t.sub }]}>{label}</Text>
      </Pressable>
    );
  }
  const fill = kind === "primary" ? t.accent : kind === "dark" ? t.ink : t.card;
  const ink = kind === "primary" ? t.accentInk : kind === "dark" ? t.bg : t.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        {
          backgroundColor: fill,
          borderColor: kind === "plain" ? t.line : fill,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {busy && <ActivityIndicator size="small" color={ink} style={{ marginRight: 8 }} />}
      <Text style={{ color: ink, fontWeight: "600", fontSize: small ? 14 : 15, letterSpacing: -0.2 }}>{label}</Text>
    </Pressable>
  );
}

/** 알약 모양 고르기 단추 (폴더, 펜 종류 등). 고른 것은 검은 바탕 */
export function Chip({
  label, on, onPress, onLongPress, hint, accessibilityLabel, role = "radio",
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  hint?: string;
  accessibilityLabel?: string;
  role?: "radio" | "button";
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={hint}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.chip, { backgroundColor: on ? t.ink : t.sunken, opacity: pressed ? 0.75 : 1 }]}
    >
      <Text style={{ color: on ? t.bg : t.sub, fontSize: 14, fontWeight: on ? "600" : "500", letterSpacing: -0.2 }}>{label}</Text>
    </Pressable>
  );
}

export type SegOption<V extends string> = { value: V; label: string; disabled?: boolean };

export function Segmented<V extends string>({
  label, options, value, onChange, note,
}: {
  label: string;
  options: SegOption<V>[];
  value: V;
  onChange: (v: V) => void;
  note?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ marginVertical: 10 }}>
      <Text style={[type.label, { color: t.ink, marginBottom: 8 }]}>{label}</Text>
      <View style={styles.segRow} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => !o.disabled && onChange(o.value)}
              disabled={o.disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: !!o.disabled }}
              style={[styles.chip, { backgroundColor: on ? t.ink : t.sunken, opacity: o.disabled ? 0.4 : 1 }]}
            >
              <Text style={{ color: on ? t.bg : t.sub, fontSize: 14, fontWeight: on ? "600" : "500" }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {!!note && <Text style={[type.caption, { color: t.muted, marginTop: 8 }]}>{note}</Text>}
    </View>
  );
}

export function Bar({ ratio }: { ratio: number }) {
  const t = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: t.lineSoft }]}>
      <View style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: "100%", backgroundColor: t.accent }} />
    </View>
  );
}

export function Hint({ children, color, style }: { children: ReactNode; color?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={style}>
      <Text style={[type.caption, { color: color ?? t.muted }]}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 20, marginVertical: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  step: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  btn: { borderWidth: 1, borderRadius: radius.md, minHeight: 46, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  btnSmall: { minHeight: 36, paddingHorizontal: 14, borderRadius: radius.sm + 2 },
  chip: { borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14 },
  segRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  seg: { borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14 },
  bar: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 8 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
});
