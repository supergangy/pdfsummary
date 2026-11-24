// 키보드 단축키 (웹). 기기판(keys.ts)과 같은 모양으로 알린다. 글 쓰는 칸 안에서는 그 칸에 맡긴다.
import { useEffect, useRef } from "react";

export type KeyPress = { key: string; ctrl: boolean; shift: boolean; alt: boolean; repeat: boolean };

function nameOf(e: KeyboardEvent): string | null {
  const k = e.key;
  if (["PageUp", "PageDown", "ArrowLeft", "ArrowRight", "Home", "End", "Backspace", "Delete"].includes(k)) return k;
  if (k === "+" || k === "=") return "+";
  if (k === "-" || k === "_") return "-";
  if (k === "/" || k === "?") return "/";
  if (/^[a-z0-9]$/i.test(k)) return k.toLowerCase();
  return null;
}

export function useKeys(handler: (k: KeyPress) => boolean | void, active = true) {
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const key = nameOf(e);
      if (!key) return;
      if (h.current({ key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, repeat: e.repeat })) e.preventDefault();
    };
    globalThis.addEventListener?.("keydown", on);
    return () => globalThis.removeEventListener?.("keydown", on);
  }, [active]);
}
