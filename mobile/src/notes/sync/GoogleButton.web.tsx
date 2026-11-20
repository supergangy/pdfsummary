// Google로 계속하기 (웹): Google의 공식 로그인 버튼(Google Identity Services) → ID 토큰 → 서버가 확인
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { useTheme } from "../../ui";

export type GoogleIds = { web: string; ios?: string };
export type GoogleButtonProps = {
  ids: GoogleIds;
  onToken: (idToken: string) => Promise<void>;
  onError: (message: string) => void;
  label?: string;
};

type Gis = {
  initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: string; auto_select?: boolean; use_fedcm_for_button?: boolean }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
};
const gis = () => (globalThis as { google?: { accounts?: { id?: Gis } } }).google?.accounts?.id;

let loading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gis()) return Promise.resolve();
  if (!loading) {
    loading = new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => (gis() ? ok() : no(new Error("Google 로그인을 불러오지 못했어요.")));
      s.onerror = () => {
        loading = null;
        no(new Error("Google 로그인을 불러오지 못했어요. 인터넷 연결을 확인해 주세요."));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export function googleAvailable(ids: GoogleIds | null | undefined): ids is GoogleIds {
  return !!ids?.web;
}

export function GoogleButton({ ids, onToken, onError, label = "Google로 계속하기" }: GoogleButtonProps) {
  const t = useTheme();
  const box = useRef<unknown>(null); // 웹에서는 View가 곧 DOM 요소
  const cb = useRef({ onToken, onError });
  cb.current = { onToken, onError };
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let gone = false;
    loadGis()
      .then(() => {
        const el = box.current as unknown as HTMLElement | null;
        const g = gis();
        if (gone || !el || !g) return;
        g.initialize({
          client_id: ids.web,
          ux_mode: "popup",
          auto_select: false,
          use_fedcm_for_button: true,
          callback: (r) => {
            if (!r.credential) return cb.current.onError("Google에서 로그인 정보를 받지 못했어요.");
            cb.current.onToken(r.credential).catch((e) => cb.current.onError((e as Error).message));
          },
        });
        el.innerHTML = "";
        g.renderButton(el, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", locale: "ko", width: 280 });
      })
      .catch((e) => !gone && setFailed((e as Error).message));
    return () => {
      gone = true;
    };
  }, [ids.web]);

  return (
    <View accessibilityLabel={label}>
      <View ref={box as never} testID="google-button" style={{ minHeight: 44, alignSelf: "flex-start" }} />
      {!!failed && <Text style={{ color: t.bad, fontSize: 13 }}>{failed}</Text>}
    </View>
  );
}
