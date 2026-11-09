// Expo 기본 설정 + tslib(pdf-lib가 씀)는 CommonJS 판으로 (웹에서 ESM 감싸개가 default를 못 찾는 문제)
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const tslib = path.join(__dirname, "node_modules", "tslib", "tslib.js");
const prev = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "tslib") return { type: "sourceFile", filePath: tslib };
  return (prev ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
