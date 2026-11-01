"""요약집을 HTML(보기·인쇄→PDF)과 Markdown(노션·옵시디언)으로 쓴다."""

from __future__ import annotations

import html
import json
import re

CSS = """
:root{--ink:#2b2118;--head:#2a1a0e;--muted:#7a6a58;--rule:#dcc5a6;--line:#e5d3bb;--chip:#fdf7ee;--chipline:#d9bc93;
--chipink:#6b4a24;--pre:#fdf9f3;--call:#f7efe4;--callbar:#c9a27c;--memo:#eef3fc;--memobar:#7d9ad6;--star:#e8b021;--mark:#ffe066;--page:#ffffff;--bg:#f3eee6}
*{box-sizing:border-box}
html{color-scheme:light}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 "Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;word-break:keep-all;overflow-wrap:anywhere}
.book{max-width:860px;margin:28px auto;background:var(--page);padding:56px 64px 72px;box-shadow:0 1px 3px rgba(60,40,20,.08),0 8px 30px rgba(60,40,20,.06);border-radius:6px}
.cover h1{font-size:30px;line-height:1.3;margin:0 0 6px;color:var(--head)}
.cover .sub{color:var(--muted);font-size:14px}
.legend{margin:14px 0 0;padding:10px 14px;border:1px solid var(--line);border-radius:8px;font-size:13.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px 16px}
.toc{margin:22px 0 10px;padding:16px 20px;border:1px solid var(--line);border-radius:10px}
.toc h2{font-size:16px;margin:0 0 8px;border:0;padding:0}
.toc .ch{font-weight:700;margin-top:8px;font-size:14px;color:var(--head)}
.toc ol{margin:2px 0 0;padding-left:20px}
.toc li{font-size:14px;margin:1px 0}
.toc a{color:var(--ink);text-decoration:none}
.toc a:hover{text-decoration:underline}
.toc .pg{color:var(--muted);font-size:12px;margin-left:6px}
hr{border:0;border-top:1.5px solid var(--rule);margin:26px 0}
.unit{margin-top:8px}
.chapter{color:var(--muted);font-size:13px;font-weight:600;letter-spacing:.01em}
.unit>h1{font-size:28px;line-height:1.3;margin:4px 0 10px;color:var(--head);letter-spacing:-.01em}
.intro{font-size:15px;margin:0}
h2{font-size:23px;margin:0 0 12px;color:var(--head);letter-spacing:-.01em}
h3{font-size:19px;margin:22px 0 10px;color:var(--head)}
p{margin:8px 0}
ul,ol{margin:8px 0;padding-left:22px}
li{margin:3px 0}
li::marker{color:#b0763a}
b,strong{font-weight:700;color:#24170c}
code{font-family:"D2Coding","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;font-size:.86em;background:var(--chip);border:1px solid var(--chipline);color:var(--chipink);border-radius:4px;padding:0 4px;white-space:nowrap}
mark{background:linear-gradient(transparent 12%,var(--mark) 12%,var(--mark) 92%,transparent 92%);color:inherit;padding:0 1px}
table{border-collapse:collapse;width:100%;margin:10px 0 14px;font-size:14px}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{font-weight:700;background:#fffaf3}
td:first-child,th:first-child{min-width:6.5em}
pre{background:var(--pre);border:1px solid var(--line);border-radius:8px;padding:14px 18px;overflow-x:auto;font:13px/1.65 "D2Coding","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color:#4a3a2a;white-space:pre-wrap}
.callout{background:var(--call);border-left:4px solid var(--callbar);padding:9px 14px;margin:12px 0;border-radius:0 6px 6px 0}
.memo{background:var(--memo);border-left:4px solid var(--memobar);padding:9px 14px;margin:12px 0;border-radius:0 6px 6px 0}
.memo .who{font-weight:700;color:#3d5ba8;margin-right:6px}
.qa .q{border-left:4px solid var(--rule);background:#fbf7f1;padding:8px 14px;margin:10px 0;font-style:normal}
.qa .lab{font-weight:700;margin:8px 0 2px}
.points td:last-child{white-space:nowrap;color:var(--star);letter-spacing:1px;font-size:15px}
.points .ev{display:block;color:var(--muted);font-size:11.5px;letter-spacing:0}
.src{color:var(--muted);font-size:12.5px;text-align:right;margin-top:8px}
.sep{text-align:center;color:var(--muted);margin:30px 0 8px;font-size:18px}
.empty{color:var(--muted);text-align:center;padding:40px 0}
@media (max-width:700px){.book{margin:0;padding:28px 16px 48px;border-radius:0}.unit>h1,.cover h1{font-size:24px}h2{font-size:20px}table{display:block;overflow-x:auto}}
@page{size:A4;margin:16mm 15mm}
@media print{body{background:#fff}.book{box-shadow:none;margin:0;padding:0;max-width:none}.unit{break-before:page}.unit:first-of-type{break-before:auto}
table,pre,.callout,.memo,.qa{break-inside:avoid}h1,h2,h3{break-after:avoid}.toc{break-after:page}}
"""


def inline(s: str) -> str:
    """**굵게**, `코드`, ==형광펜== 를 HTML로. 나머지는 그대로 이스케이프."""
    s = html.escape(s or "")
    codes: list[str] = []

    def keep(m):
        codes.append(m.group(1))
        return f"\x00{len(codes) - 1}\x00"

    s = re.sub(r"`([^`]+)`", keep, s)
    s = re.sub(r"==(.+?)==", r"<mark>\1</mark>", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"\x00(\d+)\x00", lambda m: f"<code>{codes[int(m.group(1))]}</code>", s)
    return s.replace("\n", "<br>")


def _block_html(b: dict) -> str:
    t = b.get("type")
    text, items = b.get("text", ""), [i for i in b.get("items", []) if str(i).strip()]
    if t == "subheading":
        return f"<h3>{inline(text)}</h3>"
    if t == "paragraph":
        return f"<p>{inline(text)}</p>"
    if t in ("bullets", "numbered"):
        tag = "ul" if t == "bullets" else "ol"
        head = f"<p><b>{inline(text)}</b></p>" if text.strip() else ""
        return head + f"<{tag}>" + "".join(f"<li>{inline(i)}</li>" for i in items) + f"</{tag}>"
    if t == "table":
        cols, rows = b.get("columns", []), b.get("rows", [])
        if not cols and not rows:
            return ""
        cap = f"<p><b>{inline(text)}</b></p>" if text.strip() else ""
        thead = "<tr>" + "".join(f"<th>{inline(c)}</th>" for c in cols) + "</tr>" if cols else ""
        body = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows)
        return f"{cap}<table><thead>{thead}</thead><tbody>{body}</tbody></table>"
    if t == "code":
        return f"<pre>{html.escape(text)}</pre>"
    if t == "callout":
        body = text if text.lstrip().startswith(("📌", "⚠", "💡", "✅")) else "📌 " + text
        return f'<div class="callout">{inline(body)}</div>'
    if t == "memo":
        return f'<div class="memo"><span class="who">📝 내 메모</span>{inline(text)}</div>'
    if t == "qa":
        answers = "".join(f"<li>{inline(i)}</li>" for i in items)
        return (f'<div class="qa"><div class="lab">예상 문제</div><div class="q">{inline(text)}</div>'
                f'<div class="lab">모범 답안</div><ol>{answers}</ol></div>')
    return f"<p>{inline(text)}</p>" if text else ""


def _pages(pages: list[int]) -> str:
    if not pages:
        return ""
    pages = sorted(set(pages))
    runs, start, prev = [], pages[0], pages[0]
    for p in pages[1:] + [None]:
        if p is not None and p == prev + 1:
            prev = p
            continue
        runs.append(f"{start}" if start == prev else f"{start}–{prev}")
        if p is not None:
            start = prev = p
    return ", ".join(runs) + "쪽"


def to_html(title: str, units: list[dict], source_name: str, mark_color: str = "#ffe066", note: str = "") -> str:
    toc_rows = []
    last_ch = None
    for i, u in enumerate(units, 1):
        ch = u.get("chapter") or ""
        if ch != last_ch:
            if toc_rows:
                toc_rows.append("</ol>")
            toc_rows.append(f'<div class="ch">{html.escape(ch)}</div><ol>' if ch else "<ol>")
            last_ch = ch
        toc_rows.append(f'<li><a href="#u{i}">{html.escape(u["title"])}</a><span class="pg">{_pages(u.get("pages", []))}</span></li>')
    if toc_rows:
        toc_rows.append("</ol>")

    body = []
    for i, u in enumerate(units, 1):
        parts = [f'<article class="unit" id="u{i}">']
        if u.get("chapter"):
            parts.append(f'<div class="chapter">{html.escape(u["chapter"])}</div>')
        parts.append(f"<h1>{inline(u['title'])} 핵심 정리</h1>")
        if u.get("intro"):
            parts.append(f'<p class="intro">{inline(u["intro"])}</p>')
        n = 0
        for sec in u.get("sections", []):
            blocks = "".join(_block_html(b) for b in sec.get("blocks", []))
            if not blocks:
                continue
            n += 1
            parts.append(f"<hr><section><h2>{inline(sec['heading'])}</h2>{blocks}</section>")
        if u.get("points"):
            num = f"{n + 1}. " if n and sec_numbered(u) else ""
            rows = ""
            for p in u["points"]:
                stars = "★" * max(1, min(3, int(p.get("stars", 1))))
                ev = f'<span class="ev">{html.escape(p["evidence"])}</span>' if p.get("evidence") else ""
                rows += f"<tr><td>{inline(p['topic'])}</td><td>{inline(p['memo'])}</td><td>{stars}{ev}</td></tr>"
            parts.append(
                f'<hr><section><h2>{num}실무 및 시험 포인트 정리</h2><table class="points"><thead><tr><th>주제</th>'
                f"<th>핵심 암기 내용</th><th>출제 빈도</th></tr></thead><tbody>{rows}</tbody></table></section>"
            )
        parts.append(f'<p class="src">원본 {_pages(u.get("pages", []))}</p></article>')
        body.append("".join(parts))
    joined = '<div class="sep">⁂</div>'.join(body) if body else '<p class="empty">정리할 내용을 찾지 못했습니다.</p>'

    toc = f'<nav class="toc"><h2>목차</h2>{"".join(toc_rows)}</nav>' if len(units) >= 2 else ""
    note_html = f'<p class="sub">{html.escape(note)}</p>' if note else ""
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} 핵심 정리</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800&display=swap">
<style>{CSS}:root{{--mark:{mark_color}}}</style></head>
<body><main class="book">
<header class="cover"><h1>{html.escape(title)} — 핵심 정리</h1>
<div class="sub">원본 {html.escape(source_name)} · 주제 {len(units)}개 · AI가 책 내용과 내 표시를 바탕으로 정리</div>{note_html}
<div class="legend"><span><mark>형광펜</mark> 내가 칠한 부분</span><span>📝 내 메모</span><span><span style="color:var(--star)">★★★</span> 출제 빈도 (책의 기출 표시 기준)</span></div>
</header>
{toc}
{joined}
</main></body></html>
"""


def sec_numbered(u: dict) -> bool:
    secs = [s for s in u.get("sections", []) if s.get("blocks")]
    return bool(secs) and all(s["heading"].strip()[:1].isdigit() for s in secs)


# ── Markdown ───────────────────────────────────────────────────────────

def _md_cell(s: str) -> str:
    return (s or "").replace("|", "\\|").replace("\n", "<br>")


def _block_md(b: dict) -> str:
    t = b.get("type")
    text, items = b.get("text", ""), [i for i in b.get("items", []) if str(i).strip()]
    if t == "subheading":
        return f"#### {text}"
    if t == "paragraph":
        return text
    if t in ("bullets", "numbered"):
        head = f"**{text}**\n\n" if text.strip() else ""
        return head + "\n".join((f"- {i}" if t == "bullets" else f"{n}. {i}") for n, i in enumerate(items, 1))
    if t == "table":
        cols, rows = b.get("columns", []), b.get("rows", [])
        if not cols:
            return ""
        cap = f"**{text}**\n\n" if text.strip() else ""
        lines = ["| " + " | ".join(_md_cell(c) for c in cols) + " |", "|" + "---|" * len(cols)]
        lines += ["| " + " | ".join(_md_cell(c) for c in r) + " |" for r in rows]
        return cap + "\n".join(lines)
    if t == "code":
        return f"```\n{text}\n```"
    if t == "callout":
        body = text if text.lstrip().startswith(("📌", "⚠", "💡", "✅")) else "📌 " + text
        return f"> {body}"
    if t == "memo":
        return f"> 📝 **내 메모** {text}"
    if t == "qa":
        return f"**예상 문제**\n\n> {text}\n\n**모범 답안**\n\n" + "\n".join(f"{n}. {i}" for n, i in enumerate(items, 1))
    return text


def to_markdown(title: str, units: list[dict], source_name: str) -> str:
    out = [f"# {title} — 핵심 정리", "", f"> 원본 {source_name} · ==형광펜== 내가 칠한 부분 · 📝 내 메모 · ★ 출제 빈도", ""]
    if len(units) >= 2:
        out += ["**목차**", ""]
        out += [f"{i}. {u['title']} ({_pages(u.get('pages', []))})" for i, u in enumerate(units, 1)]
        out.append("")
    for u in units:
        out += ["---", ""]
        if u.get("chapter"):
            out += [f"*{u['chapter']}*", ""]
        out += [f"## {u['title']} 핵심 정리", ""]
        if u.get("intro"):
            out += [u["intro"], ""]
        n = 0
        for sec in u.get("sections", []):
            blocks = [x for x in (_block_md(b) for b in sec.get("blocks", [])) if x.strip()]
            if not blocks:
                continue
            n += 1
            out += [f"### {sec['heading']}", ""]
            for x in blocks:
                out += [x, ""]
        if u.get("points"):
            num = f"{n + 1}. " if n and sec_numbered(u) else ""
            out += [f"### {num}실무 및 시험 포인트 정리", "", "| 주제 | 핵심 암기 내용 | 출제 빈도 |", "|---|---|---|"]
            for p in u["points"]:
                stars = "★" * max(1, min(3, int(p.get("stars", 1))))
                ev = f" ({p['evidence']})" if p.get("evidence") else ""
                out.append(f"| {_md_cell(p['topic'])} | {_md_cell(p['memo'])} | {stars}{_md_cell(ev)} |")
            out.append("")
        out += [f"<sub>원본 {_pages(u.get('pages', []))}</sub>", ""]
    return "\n".join(out).rstrip() + "\n"


def to_json(title: str, units: list[dict]) -> str:
    return json.dumps({"title": title, "units": units}, ensure_ascii=False, indent=2)
