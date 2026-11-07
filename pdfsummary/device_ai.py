"""기기 안 AI: 태블릿·폰에 들어 있는 작은 AI(아이패드 Apple 기기 안 AI, 갤럭시 Gemini Nano)에
단원 개요와 표시마다 한 줄 설명을 맡긴다. 인터넷 AI·API 키·비용 없음.

흐름 (앱용 서버):
1. 서버가 표시 찾기·목차 정리까지 하고(--context device), 기기 AI에게 시킬 짧은 일감을 만든다.
   정리 상태는 작업 폴더에 남겨 둔다.
2. 앱이 일감(GET /api/job/<id>/device-tasks)을 받아 기기 안 AI로 하나씩 답을 쓴다.
3. 앱이 답(글 그대로)을 보내면(POST /api/job/<id>/device-answers) 서버가 읽어서 요약에 넣고 다시 그린다.

기기 안 AI는 한 번에 읽을 수 있는 양이 4천 토큰쯤이고(한글은 대략 한 글자가 한 토큰),
형식을 강제하는 기능이 기기마다 달라서, 일감은 짧게 자르고 답은 "개요: … / 1: …" 줄 형식으로 받아
여기(서버)에서 너그럽게 읽는다.
"""

from __future__ import annotations

import pickle
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

STATE_FILE = ".device_ai_state.pkl"
TEXT_CHARS = 1400        # 단원 본문 발췌 길이 (한글 기준)
MARK_CHARS = 110         # 표시 하나를 보여 줄 길이
MARKS_PER_TASK = 6       # 한 일감에 넣을 표시 수
OVERVIEW_CHARS = 320
NOTE_CHARS = 220

INSTRUCTIONS = (
    "당신은 학생의 공부 노트 정리를 돕습니다. 한국어로 짧고 정확하게 답합니다. "
    "주어진 본문과 표시에 근거한 내용만 쓰고, 없는 사실을 지어내지 않습니다. "
    "표시한 문장을 그대로 다시 쓰지 않습니다. 요청한 형식의 줄만 씁니다."
)


@dataclass
class DeviceState:
    """두 번째 단계(답 넣고 다시 그리기)에 필요한 것들."""
    title: str
    pdf_name: str
    labels: dict
    group_by: str
    formats: set
    tree: object
    marks: list
    tasks: list = field(default_factory=list)   # [{id, node, uids, overview}]


def _clip(s: str, n: int) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _path(node) -> str:
    m = node.marks[0] if node.marks else None
    if m is not None and m.heading_path:
        return " > ".join(m.heading_path)
    return node.title or "(제목 없음)"


def _prompt(book: str, node, text: str, marks: list, want_overview: bool) -> str:
    lines = []
    for i, m in enumerate(marks, 1):
        line = f"[{i}] {_clip(m.body, MARK_CHARS)}"
        memo = " / ".join(_clip(n.body, 60) for n in m.notes if n.body)
        if memo:
            line += f"  (학생 메모: {memo})"
        lines.append(line)
    parts = [f"책: {_clip(book, 80)}", f"단원: {_clip(_path(node), 120)}"]
    if text:
        parts.append(f"[단원 본문 일부]\n{text}")
    parts.append("[학생이 표시한 부분]\n" + "\n".join(lines))
    fmt = []
    if want_overview:
        fmt.append("개요: 이 단원이 무엇을 다루고, 표시한 내용이 그 흐름에서 어디쯤인지 2문장")
    for i in range(1, len(marks) + 1):
        fmt.append(f"{i}: {i}번 표시를 이해하는 데 필요한 앞뒤 설명 한 문장 (필요 없으면 -)")
    parts.append("아래 형식의 줄만 그대로 쓰세요.\n" + "\n".join(fmt))
    return "\n\n".join(parts)


def _parent_prompt(book: str, node) -> str:
    """상위 단원 개요: 하위 단원 제목과 그 아래 표시들만 보고 쓴다 (본문은 넣지 않아 짧다)."""
    lines, left = [], 10
    groups = [(None, node.marks)] + [(c, [m for n in c.walk() for m in n.marks]) for c in node.children]
    for child, ms in groups:
        ms = [m for m in ms if (m.body or "").strip()]
        if not ms or left <= 0:
            continue
        if child is not None:
            lines.append(f"## {_clip(child.title or '(제목 없음)', 60)}")
        for m in ms[:min(3, left)]:
            lines.append(f"- {_clip(m.body, 90)}")
            left -= 1
    return "\n\n".join([
        f"책: {_clip(book, 80)}",
        f"단원: {_clip(node.title or '(책 전체)', 120)}",
        "[이 단원 아래 소단원과 학생이 표시한 부분]\n" + "\n".join(lines),
        "아래 형식의 줄만 그대로 쓰세요.\n개요: 이 단원 전체가 무엇을 다루고 소단원들이 어떻게 이어지는지 2문장",
    ])


def build_tasks(book: str, tree, get_text: Callable) -> tuple[list[dict], list[dict]]:
    """기기 AI 일감들. 돌려주는 값: (앱에 보낼 일감, 서버가 기억할 짝 정보)."""
    from .outline import section_text

    public, private = [], []
    nodes = list(tree.walk())
    # 하위 단원이 여럿인 상위 단원 (Claude 쪽과 같은 규칙): 개요만 따로
    parents = {id(n) for n in nodes if (len(n.children) >= 2 or (n.children and n.marks)) and n.count()}

    def add(node, ni, prompt, fallback, uids, overview):
        tid = f"t{len(public) + 1}"
        public.append({"id": tid, "title": _clip(node.title or _path(node), 60), "instructions": INSTRUCTIONS,
                       # fallback: 기기 AI가 너무 길다고 거절하면 본문 발췌 없이 다시 시도할 짧은 판
                       "prompt": prompt, "fallback": fallback})
        private.append({"id": tid, "node": ni, "uids": uids, "overview": overview})

    for ni, node in enumerate(nodes):
        if id(node) in parents:
            pr = _parent_prompt(book, node)
            add(node, ni, pr, pr, [], True)
        marks = [m for m in node.marks if (m.body or "").strip()]
        if not marks:
            continue   # 글자 없는 표시(그림 손글씨 등)는 기기 AI가 볼 수 없다
        text, _ = section_text(node, get_text, cap=TEXT_CHARS)
        text = _clip(text, TEXT_CHARS)
        # 표시 하나뿐인 작은 단원은 개요가 그 표시 설명과 겹친다
        want_overview = id(node) not in parents and len(node.marks) >= 2
        for ci in range(0, len(marks), MARKS_PER_TASK):
            chunk = marks[ci: ci + MARKS_PER_TASK]
            first = ci == 0 and want_overview
            add(node, ni, _prompt(book, node, text, chunk, first), _prompt(book, node, "", chunk, first),
                [m.uid for m in chunk], first)
    return public, private


_OVERVIEW = re.compile(r"^\s*[*#>\-\s]*(?:\*\*)?개요(?:\*\*)?\s*[:：]\s*(.*)$")
_ITEM = re.compile(r"^\s*[*#>\-\s]*\[?(\d{1,2})\]?\s*[:：.)\]]\s*(.*)$")
_EMPTY = {"", "-", "–", "—", "없음", "(없음)", "없음.", "필요 없음", "필요없음", "n/a", "none"}


def _clean(s: str, n: int) -> str:
    s = s.strip().strip('"“”').strip()
    s = re.sub(r"^\*\*|\*\*$", "", s).strip()
    if s.lower() in _EMPTY or s.startswith(("(필요 없", "필요 없")):
        return ""
    return _clip(s, n)


def parse_answer(text: str, count: int) -> tuple[str, dict[int, str]]:
    """'개요: …' 과 'N: …' 줄을 읽는다. 줄이 이어지면 앞 항목에 붙인다. 돌려주는 값: (개요, {번호: 설명})."""
    overview, items = "", {}
    cur: Optional[tuple[str, int]] = None
    buf: dict = {}
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            cur = None
            continue
        m = _OVERVIEW.match(line)
        if m:
            cur = ("o", 0)
            buf[cur] = m.group(1)
            continue
        m = _ITEM.match(line)
        if m and 1 <= int(m.group(1)) <= count:
            cur = ("i", int(m.group(1)))
            buf[cur] = m.group(2)
            continue
        if cur is not None:   # 앞 줄에 이어지는 말
            buf[cur] += " " + line
    for (kind, i), v in buf.items():
        if kind == "o":
            overview = _clean(v, OVERVIEW_CHARS)
        else:
            note = _clean(v, NOTE_CHARS)
            if note:
                items[i] = note
    return overview, items


def save_state(out_dir: Path, st: DeviceState) -> None:
    # 서버가 자기 작업 폴더에 쓰고 자기만 읽는 파일이다 (밖에서 받은 것을 읽지 않는다)
    with open(out_dir / STATE_FILE, "wb") as f:
        pickle.dump(st, f)


def load_state(out_dir: Path) -> Optional[DeviceState]:
    p = out_dir / STATE_FILE
    if not p.exists():
        return None
    with open(p, "rb") as f:
        return pickle.load(f)


def apply_answers(st: DeviceState, answers: dict) -> tuple[int, int]:
    """앱이 보낸 답을 단원 개요·표시 설명에 넣는다. 돌려주는 값: (넣은 개요 수, 넣은 설명 수)."""
    nodes = list(st.tree.walk())
    by_uid = {m.uid: m for m in _all(st.marks)}
    n_over = n_note = 0
    for t in st.tasks:
        text = answers.get(t["id"])
        if not isinstance(text, str) or not text.strip():
            continue
        overview, items = parse_answer(text[:20000], len(t["uids"]))
        if t["overview"] and overview:
            nodes[t["node"]].overview = overview
            n_over += 1
        for i, uid in enumerate(t["uids"], 1):
            m = by_uid.get(uid)
            if m is not None and items.get(i):
                m.ai_context = items[i]
                n_note += 1
    return n_over, n_note


def _all(marks):
    for m in marks:
        yield m
        yield from _all(m.notes)


def render(out_dir: Path, st: DeviceState) -> list[Path]:
    from .cli import write_list

    return write_list(out_dir, st.title, st.tree, st.marks, st.labels, st.pdf_name, st.group_by, st.formats)
