// 안드로이드: 암호화 안 된 http는 이 기기 안(localhost·127.0.0.1)으로만 허용한다. 다른 주소는 지금처럼 https만.
// 쓰임: PC에서 앱용 서버를 켜고 USB 선으로 `adb reverse tcp:8080 tcp:8080` 한 뒤 앱 설정의 서버 주소를
// http://127.0.0.1:8080 으로 넣어 시험할 때 (서버는 PC 안에서만 열리고 밖에서는 못 봄).
// 개발용(debug) 빌드는 Metro 개발 서버에 http로 붙어야 하므로 debug 쪽 설정 파일은 모두 허용으로 덮어쓴다.
const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const RELEASE = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

const DEBUG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

module.exports = function withLocalhostHttp(config) {
  config = withDangerousMod(config, [
    "android",
    async (c) => {
      const app = path.join(c.modRequest.platformProjectRoot, "app", "src");
      for (const [set, xml] of [["main", RELEASE], ["debug", DEBUG]]) {
        const dir = path.join(app, set, "res", "xml");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "network_security_config.xml"), xml);
      }
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    application.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return c;
  });
};
