// 화면 부품과 색 (밝은·어두운 모드)
import { createContext, useContext, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

export type Theme = {
  bg: string;
  card: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
  soft: string;
  ok: string;
  bad: string;
  warn: string;
};

export const LIGHT: Theme = {
  bg: "#f6f5f1", card: "#ffffff", ink: "#202328", muted: "#6a707a", line: "#e5e2da",
  accent: "#2f6fde", accentInk: "#ffffff", soft: "#eef3fd", ok: "#1f8a4c", bad: "#c23b3b", warn: "#b26a00",
};
export const DARK: Theme = {
  bg: "#141518", card: "#1e2025", ink: "#e7e8ea", muted: "#9aa0a8", line: "#31343b",
  accent: "#6f9cf5", accentInk: "#0d1220", soft: "#1f2a40", ok: "#54c58a", bad: "#ff7b7b", warn: "#f0b35a",
};

export const ThemeContext = createContext<Theme>(LIGHT);
export const useTheme = () => useContext(ThemeContext);

export function Card({ step, title, children, right }: { step?: number; title: string; children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <View style={styles.cardHead}>
        {step != null && (
          <View style={[styles.step, { backgroundColor: t.accent }]}>
            <Text style={{ color: t.accentInk, fontSize: 12, fontWeight: "700" }}>{step}</Text>
          </View>
        )}
        <Text style={[styles.cardTitle, { color: t.ink }]}>{title}</Text>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

export function Button({
  label, onPress, kind = "plain", disabled, busy, style, accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  kind?: "plain" | "primary" | "link";
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  if (kind === "link") {
    return (
      <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} hitSlop={8}>
        <Text style={{ color: disabled ? t.muted : t.accent, fontSize: 15, textDecorationLine: "underline" }}>{label}</Text>
      </Pressable>
    );
  }
  const primary = kind === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: primary ? t.accent : t.card,
          borderColor: primary ? t.accent : t.line,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy && <ActivityIndicator size="small" color={primary ? t.accentInk : t.accent} style={{ marginRight: 8 }} />}
      <Text style={{ color: primary ? t.accentInk : t.ink, fontWeight: "600", fontSize: primary ? 17 : 15 }}>{label}</Text>
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
      <Text style={{ color: t.ink, fontWeight: "600", marginBottom: 8 }}>{label}</Text>
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
              style={[
                styles.seg,
                { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : t.card, opacity: o.disabled ? 0.4 : 1 },
              ]}
            >
              <Text style={{ color: on ? t.accentInk : t.ink, fontSize: 14 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {!!note && <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 6 }}>{note}</Text>}
    </View>
  );
}

export function Bar({ ratio }: { ratio: number }) {
  const t = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: t.line }]}>
      <View style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: "100%", backgroundColor: t.accent }} />
    </View>
  );
}

export function Hint({ children, color, style }: { children: ReactNode; color?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={style}>
      <Text style={{ color: color ?? t.muted, fontSize: 13, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 18, marginVertical: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  step: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  btn: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  segRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  seg: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  bar: { height: 6, borderRadius: 3, overflow: "hidden", marginTop: 8 },
});
