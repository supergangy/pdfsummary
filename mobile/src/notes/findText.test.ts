import { test } from "node:test";
import assert from "node:assert/strict";
import { countInText, findInText } from "./findText.ts";

test("찾기: 띄어쓰기·대소문자 무시, 원래 글로 앞뒤를 보여 줌", () => {
  const text = "윈도우 인증과정에서 사용되는 주요 서비스에는 LSA(Local Security Authority), SAM 이 있다.\n네트 워크 보안은 중요하다.";
  const [h] = findInText(text, "local security");
  assert.equal(h.mark, "Local Security");
  assert.ok(h.before.endsWith("LSA("));
  const [n] = findInText(text, "네트워크");
  assert.equal(n.mark, "네트 워크"); // PDF가 띄어 쓴 곳도 찾는다
  assert.equal(countInText(text, "sa"), 2); // LSA, SAM
  assert.deepEqual(findInText(text, "   "), []);
  assert.deepEqual(findInText(text, "없는말"), []);
});

test("찾기: 한 쪽에서 여러 곳, 많아야 max개", () => {
  const text = "SAM 파일 SAM 계정 SAM 데이터베이스 SAM";
  assert.equal(findInText(text, "sam", 3).length, 3);
  assert.equal(countInText(text, "sam"), 4);
});
