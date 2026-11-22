import { test } from "node:test";
import assert from "node:assert/strict";
import { A4, type Stroke } from "./model.ts";
import { charsToText, layoutStudyNote, studyBoxesToMeasure, type MarkLook, type StudySection } from "./studyNote.ts";
import { measureKey } from "./myNote.ts";

const SECTION: StudySection = {
  title: "1과목 시스템, S01. 시스템 기본학습 핵심 정리",
  intro: "리눅스/윈도우 인증·계정 관리, 파일 시스템, 프로세스·권한이 반복 출제됩니다.",
  blocks: [
    { type: "heading", level: 1, text: "1. 개념 및 배경" },
    { type: "paragraph", text: "시스템 기본학습은 운영체제의 인증, 계정, 파일 권한, 프로세스 구조를 이해하고 공격과 방어를 아는 것이 목표입니다." },
    { type: "heading", level: 1, text: "2. 동작 원리 / 구조" },
    { type: "heading", level: 2, text: "리눅스 인증 파일 구조" },
    { type: "table", text: "", columns: ["파일", "경로", "내용"], rows: [["passwd", "/etc/passwd", "사용자 계정 정보"], ["shadow", "/etc/shadow", "암호화된 패스워드"], ["group", "/etc/group", "그룹 정보"]], mark_ids: ["m1"] },
    { type: "bullets", text: "shadow 암호화 알고리즘 — 반드시 암기!", items: ["$1$ = MD5", "$5$ = SHA-256", "$6$ = SHA-512"], mark_ids: ["m2"] },
    { type: "code", text: "# SUID 파일 탐지 (시험 단골)\nfind / -user root -type f -perm -4000 | xargs ls -al\nchmod -s [파일명]" },
    { type: "callout", text: "침해사고 분석 시 Mtime 기준으로 악성 파일 탐지" },
    { type: "steps", items: ["클라이언트 인증 요청", "서버 Challenge 전송", "Response 생성", "서버 검증"] },
    { type: "heading", level: 1, text: "3. 예시 / 적용 시나리오" },
    { type: "qa", q: "shadow 파일의 $6$는 어떤 알고리즘인가?", a: "SHA-512. $1$은 MD5, $5$는 SHA-256이다." },
  ],
  points: [
    { topic: "shadow 해시", key: "$1$=MD5, $5$=SHA-256, $6$=SHA-512", stars: 3 },
    { topic: "SUID 탐지", key: "find -perm -4000, chmod -s", stars: 2 },
  ],
  strategy: "NTLM 4단계, 버퍼 오버플로우 공격/대응은 순서대로 쓸 수 있어야 합니다.",
};

const MARKS = new Map<string, MarkLook>([
  ["m1", { color: "#FFE14D", opacity: 0.75, label: "핵심" }],
  ["m2", { color: "#FF9EC7", opacity: 0.75, label: "외울 것" }],
]);

function overlaps(ss: Stroke[]): string[] {
  const boxes = ss.filter((s) => s.tool === "text");
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].pts, b = boxes[j].pts;
      if (a[0] < b[3] - 0.5 && b[0] < a[3] - 0.5 && a[1] < b[4] - 0.5 && b[1] < a[4] - 0.5) bad.push(`${boxes[i].text} ↔ ${boxes[j].text}`);
    }
  return bad;
}

test("study note: sections drawn like a textbook summary, inside the page, nothing overlapping", () => {
  const { nb, ink } = layoutStudyNote("정보보안기사 실기 정리", "정보기실기", [SECTION], MARKS, Date.UTC(2026, 10, 23, 3));
  const all = Object.values(ink).flat();
  const texts = all.filter((s) => s.tool === "text").map((s) => s.text);
  for (const t of ["정보보안기사 실기 정리", "1과목 시스템, S01. 시스템 기본학습 핵심 정리", "1. 개념 및 배경", "리눅스 인증 파일 구조", "/etc/shadow", "$6$ = SHA-512",
    "Q. shadow 파일의 $6$는 어떤 알고리즘인가?", "실무 및 시험 포인트 정리", "출제 빈도", "★★★", "★★", "핵심", "외울 것"]) {
    assert.ok(texts.includes(t), `없음: ${t}`);
  }
  assert.ok(texts.some((t) => t?.startsWith("서술형 고득점 전략:")));
  // 별은 노란색, 표시한 블록은 왼쪽 여백에 표시 색 막대
  assert.equal(all.find((s) => s.text === "★★★")!.color, "#E0A100");
  const bars = all.filter((s) => s.tool === "highlighter" && s.width === 4 && s.pts[0] < 54);
  assert.ok(bars.some((b) => b.color === "#FFE14D") && bars.some((b) => b.color === "#FF9EC7"));
  for (const p of nb.pages) {
    assert.deepEqual(overlaps(ink[p.id]), []);
    for (const s of ink[p.id]) for (let i = 0; i < s.pts.length; i += 3) {
      assert.ok(s.pts[i] >= 0 && s.pts[i] <= A4.w && s.pts[i + 1] >= 0 && s.pts[i + 1] <= A4.h, `쪽 밖: ${s.text ?? s.tool}`);
    }
  }
});

test("study note: many sections flow onto more pages and use measured heights", () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ ...SECTION, title: `섹션 ${i + 1}` }));
  const { nb, ink } = layoutStudyNote("긴 노트", "책", many, MARKS);
  assert.ok(nb.pages.length >= 4, `쪽 수 ${nb.pages.length}`);
  for (const p of nb.pages) {
    assert.deepEqual(overlaps(ink[p.id]), []);
    for (const s of ink[p.id].filter((x) => x.tool === "text")) assert.ok(s.pts[4] <= A4.h - 30, `아래 여백 침범: ${s.text}`);
  }
  // 기기에서 잰 높이가 더 크면 그만큼 아래로 밀린다
  const boxes = studyBoxesToMeasure("긴 노트", "책", many, MARKS);
  const para = boxes.find((b) => b.text.startsWith("시스템 기본학습은"))!;
  const tall = layoutStudyNote("긴 노트", "책", many, MARKS, 0, (t, s, w) => (measureKey(t, s, w) === para.key ? 200 : undefined));
  const p = Object.values(tall.ink).flat().find((s) => s.text === para.text)!;
  assert.equal(p.pts[4] - p.pts[1], 200);
  for (const pg of tall.nb.pages) assert.deepEqual(overlaps(tall.ink[pg.id]), []);
});

test("page characters become plain text", () => {
  const cs = [..."가나 \n\n\n\n다"].map((c) => [c, 0, 0, 1, 1] as [string, number, number, number, number]);
  assert.equal(charsToText(cs), "가나\n\n다");
  assert.equal(charsToText(null), "");
});

test("question and answer labels are not doubled", () => {
  const sec: StudySection = { title: "S", intro: "", blocks: [{ type: "qa", q: "Q. 스택으로 구현할 수 없는 것은?", a: "정답: ④ 은행 대기열" }], points: [], strategy: "" };
  const texts = Object.values(layoutStudyNote("t", "s", [sec], new Map()).ink).flat().map((x) => x.text);
  assert.ok(texts.includes("Q. 스택으로 구현할 수 없는 것은?"));
  assert.ok(texts.includes("답: ④ 은행 대기열"));
});
