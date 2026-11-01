import { createElement } from "react";

export function ResultView({ html }: { html: string }) {
  return createElement("iframe", {
    srcDoc: html,
    title: "요약",
    sandbox: "allow-scripts allow-same-origin",
    style: { flex: 1, width: "100%", height: "100%", border: "0", background: "transparent" },
  });
}
