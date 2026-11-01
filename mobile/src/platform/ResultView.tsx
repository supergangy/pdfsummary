// 요약 HTML을 앱 안에서 보여 준다. 링크(목차 이동)는 안에서, 바깥 링크는 막는다.
import { WebView } from "react-native-webview";

export function ResultView({ html }: { html: string }) {
  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html, baseUrl: "about:blank" }}
      style={{ flex: 1, backgroundColor: "transparent" }}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(req) => req.url.startsWith("about:") || req.url.startsWith("data:") || req.url.includes("#")}
    />
  );
}
