// app.json에 더해, 빌드할 때 정하는 것들.
//
// Google 로그인 (iOS): Google Cloud에서 만든 'iOS 클라이언트 ID'를 빌드할 때 알려 주면
// Google 로그인 화면에서 앱으로 돌아오는 주소(URL scheme)를 앱에 넣는다. 서버의 PDFSUMMARY_GOOGLE_IOS_CLIENT_ID와 같아야 한다.
//   GOOGLE_IOS_CLIENT_ID=1234-abcd.apps.googleusercontent.com npx expo prebuild   (EAS 빌드는 eas.json의 env나 EAS 환경 변수로)
// 안드로이드·웹은 Google 로그인을 위해 빌드할 때 따로 넣을 것이 없다 (클라이언트 ID는 서버가 알려 줌).
module.exports = ({ config }) => {
  const iosId = (process.env.GOOGLE_IOS_CLIENT_ID || "").trim();
  const plugins = [...(config.plugins || [])];
  if (iosId) {
    const scheme = "com.googleusercontent.apps." + iosId.replace(/\.apps\.googleusercontent\.com$/, "");
    plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme: scheme }]);
  }
  // 안드로이드 설치 파일(APK)의 버전 번호: CI가 빌드 번호를 넣어 새 APK가 항상 더 높은 번호가 되게 (덮어 설치)
  const code = parseInt(process.env.ANDROID_VERSION_CODE || "", 10);
  const android = { ...(config.android || {}), ...(code > 0 ? { versionCode: code } : {}) };
  return { ...config, android, plugins, extra: { ...(config.extra || {}), googleIosClientId: iosId || null } };
};
