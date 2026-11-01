"""요약본을 HTML(바로 보기·인쇄용), Markdown(노션·옵시디언용), JSON(데이터)으로 쓴다."""

from __future__ import annotations

import base64
import html
import json
from collections import Counter
from pathlib import Path

from .colors import COLOR_NAMES, color_css, color_key, color_name
from .models import HANDWRITING, KIND_LABELS, NOTE, Mark
from .organize import Section, all_marks

EMOJI = {
    "yellow": "🟨", "orange": "🟧", "red": "🟥", "pink": "🩷", "purple": "🟪",
    "blue": "🟦", "green": "🟩", "black": "⬛", "gray": "⬜",
}


def stats(marks: list[Mark]) -> Counter:
    return Counter(m.kind for m in all_marks(marks))


def stats_line(marks: list[Mark]) -> str:
    c = stats(marks)
    order = ["highlight", "underline", "circle", "strikeout", "handwriting", "note"]
    return " · ".join(f"{KIND_LABELS[k]} {c[k]}" for k in order if c[k])


def _label(m: Mark, labels: dict[str, str]) -> str:
    if m.kind in (HANDWRITING, NOTE):
        return KIND_LABELS[m.kind]
    key = color_key(m.color)
    extra = labels.get(key)
    base = f"{KIND_LABELS[m.kind]} · {color_name(m.color)}"
    return f"{base} · {extra}" if extra else base


def _image_name(m: Mark, n: int) -> str:
    return f"p{m.page_no:04d}_{n:03d}.png"


# ── Markdown ───────────────────────────────────────────────────────────

def to_markdown(title: str, sections: list[Section], labels: dict[str, str], image_dir: Path, rel_dir: str,
                show_path: bool = False) -> str:
    image_dir.mkdir(parents=True, exist_ok=True)
    counter = [0]
    marks = [m for s in sections for m in s.marks]
    out = [f"# {title} — 필기 요약", "", f"> {stats_line(marks)}", ""]
    if labels:
        out.append("> 색 구분: " + ", ".join(f"{EMOJI[k]} {COLOR_NAMES[k][0]} = {v}" for k, v in labels.items()))
        out.append("")
    if any(s.overview for s in sections):
        out.append("> 💡 표시는 AI가 책 본문을 바탕으로 붙인 설명입니다. 형광펜 원문과 구분해서 보세요.")
        out.append("")

    titled = [s for s in sections if s.title]
    if len(titled) >= 2:
        out.append("**목차**")
        out.append("")
        base = min(s.level for s in titled)
        for s in titled:
            out.append(f"{'  ' * (s.level - base)}- {s.title} ({s.count})")
        out.append("")

    def img(m: Mark) -> str:
        counter[0] += 1
        name = _image_name(m, counter[0])
        (image_dir / name).write_bytes(m.image)
        return f"![p.{m.page_no} 원본]({rel_dir}/{name})"

    def item(m: Mark, indent: str) -> list[str]:
        lines = []
        where = f"p.{m.page_no}"
        if show_path and m.heading_path:
            where = " > ".join(m.heading_path) + " · " + where
        if m.kind in (HANDWRITING, NOTE):
            icon = "✍️" if m.kind == HANDWRITING else "📝"
            body = m.body or ("(원본 이미지)" if m.image else "")
            if m.kind == HANDWRITING and m.transcription and m.confidence in ("medium", "low") and not m.is_symbol:
                body += " ⚠️애매" + (f"({', '.join(m.unclear)})" if m.unclear else "")
            lines.append(f"{indent}- {icon} {_md_inline(body)}  `{where}`")
        else:
            emoji = EMOJI[color_key(m.color)]
            if m.sentence:
                body = "".join(f"**{t.strip()}**" if hl else t for t, hl in _tight(m.sentence)).replace("\n", " ")
            else:
                body = f"**{_md_inline(m.text)}**" if m.text else "(원본 이미지)"
            if m.kind == "strikeout":
                body = f"~~{body}~~"
            lines.append(f"{indent}- {emoji} {body}  `{where} · {_label(m, labels)}`")
        if m.ai_context:
            lines.append(f"{indent}  - 💡 {_md_inline(m.ai_context)}")
        if m.show_image and m.image:
            lines.append(f"{indent}  {img(m)}")
        for n in m.notes:
            lines.extend(item(n, indent + "  "))
        return lines

    for s in sections:
        if s.title:
            out.append(f"{'#' * min(s.level + 1, 5)} {s.title}")
            out.append("")
        if s.overview:
            out.append(f"> 💡 **개요** {_md_inline(s.overview)}")
            out.append("")
        for m in s.marks:
            out.extend(item(m, ""))
        if s.marks:
            out.append("")
    return "\n".join(out).rstrip() + "\n"


def _tight(runs: list[tuple[str, bool]]) -> list[tuple[str, bool]]:
    """마크다운 굵게(**)는 안쪽 끝에 공백이 있으면 깨지므로, 표시 조각의 앞뒤 공백을 바깥 조각으로 옮긴다."""
    out: list[tuple[str, bool]] = []
    for t, hl in runs:
        if hl:
            lead = t[: len(t) - len(t.lstrip())]
            trail = t[len(t.rstrip()):]
            if lead:
                out.append((lead, False))
            out.append((t.strip(), True))
            if trail:
                out.append((trail, False))
        else:
            out.append((t, False))
    return out


def _md_inline(s: str) -> str:
    return s.replace("\n", " / ").strip()


# ── HTML ───────────────────────────────────────────────────────────────

CSS = """
:root{--bg:#fbfaf7;--card:#fff;--ink:#22252a;--muted:#6b7078;--line:#e7e4dd;--warn:#b26a00;--accent:#3b6fd8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#17181b;--card:#202227;--ink:#e8e8ea;--muted:#9a9ea6;--line:#33363d;--warn:#f0b35a;--accent:#7aa2f7}}
:root[data-theme="dark"]{--bg:#17181b;--card:#202227;--ink:#e8e8ea;--muted:#9a9ea6;--line:#33363d;--warn:#f0b35a;--accent:#7aa2f7}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 "Pretendard","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",system-ui,sans-serif}
main{max-width:820px;margin:0 auto;padding:40px 16px 80px}
header h1{font-size:28px;line-height:1.3;margin:0 0 6px}
.sub{color:var(--muted);font-size:14px}
.toolbar{position:sticky;top:0;z-index:2;background:var(--bg);padding:12px 0;margin:20px 0 8px;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:3px 12px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.chip[aria-pressed="false"]{opacity:.4}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block}
h2{font-size:21px;margin:36px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
h3{font-size:18px;margin:28px 0 10px}
.item{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--c);border-radius:10px;padding:12px 16px;margin:10px 0}
.item .text{white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}
.item .text mark{background:color-mix(in srgb,var(--c) 45%,transparent);color:inherit;padding:0 2px;border-radius:3px}
.item.strikeout .text{text-decoration:line-through}
.meta{color:var(--muted);font-size:12.5px;margin-top:4px}
.notes{margin:10px 0 0;padding:0;list-style:none}
.note{border-top:1px dashed var(--line);padding:8px 0 2px 26px;position:relative}
.note::before{content:attr(data-icon);position:absolute;left:0;top:8px}
.note.solo{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--muted);border-radius:10px;padding:12px 16px 12px 42px;margin:10px 0}
.note.solo::before{left:16px;top:12px}
.hand{font-family:"Nanum Pen Script","Gaegu",cursive;font-size:1.3em;line-height:1.4}
.warn{color:var(--warn);font-size:12.5px;margin-left:6px;white-space:nowrap}
.orig{display:block;max-width:100%;max-height:340px;margin-top:8px;border:1px solid var(--line);border-radius:6px;background:#fff}
.empty{color:var(--muted);text-align:center;padding:60px 0}
h4{font-size:16px;margin:22px 0 8px;color:var(--muted)}
h2,h3,h4{scroll-margin-top:64px}
.toc{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin:20px 0}
.toc b{font-size:14px}
.toc ol{list-style:none;margin:6px 0 0;padding:0}
.toc li{margin:2px 0;font-size:14px}
.toc a{color:var(--ink);text-decoration:none}
.toc a:hover{color:var(--accent);text-decoration:underline}
.toc .n{color:var(--muted);font-size:12px;margin-left:4px}
.overview{border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--card));padding:10px 14px;border-radius:0 8px 8px 0;margin:4px 0 14px;font-size:14.5px}
.ai-badge{display:inline-block;font-size:11px;font-weight:600;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 50%,transparent);border-radius:4px;padding:0 5px;margin-right:6px;vertical-align:1px}
.aictx{color:var(--muted);font-size:14px;margin-top:6px}
.ctx{color:var(--muted)}
.item .text mark{font-weight:600}
.path{color:var(--muted)}
.hide-ctx .ctx{display:none}
.hide-ai .aictx,.hide-ai .overview{display:none}
@media print{.toolbar,.toc{display:none}.item,.note.solo{break-inside:avoid}body{background:#fff}}
"""

JS = """
document.querySelectorAll('.chip[data-toggle]').forEach(ch=>{
  ch.addEventListener('click',()=>{
    const on=ch.getAttribute('aria-pressed')!=='false';
    ch.setAttribute('aria-pressed',on?'false':'true');
    document.body.classList.toggle(ch.dataset.toggle,on);
  });
});
const state={};
document.querySelectorAll('.chip[data-f]').forEach(ch=>{
  state[ch.dataset.f]=true;
  ch.addEventListener('click',()=>{
    const on=ch.getAttribute('aria-pressed')!=='false';
    ch.setAttribute('aria-pressed',on?'false':'true');state[ch.dataset.f]=!on;
    document.querySelectorAll('[data-filter]').forEach(el=>{
      const keys=el.dataset.filter.split(' ');
      el.style.display=keys.every(k=>state[k]!==false)?'':'none';
    });
  });
});
"""


def to_html(title: str, sections: list[Section], labels: dict[str, str], source_name: str, show_path: bool = False) -> str:
    marks = [m for s in sections for m in s.marks]
    everything = all_marks(marks)
    color_keys = []
    for m in everything:
        if m.kind not in (HANDWRITING, NOTE):
            k = color_key(m.color)
            if k not in color_keys:
                color_keys.append(k)
    color_keys.sort(key=list(COLOR_NAMES).index)

    chips = []
    for k in color_keys:
        name = COLOR_NAMES[k][0] + (f" · {labels[k]}" if k in labels else "")
        chips.append(
            f'<button class="chip" data-f="c-{k}" aria-pressed="true"><span class="dot" style="background:{COLOR_NAMES[k][1]}"></span>{html.escape(name)}</button>'
        )
    for kind, label in (("handwriting", "✍️ 손글씨"), ("note", "📝 메모")):
        if any(m.kind == kind for m in everything):
            chips.append(f'<button class="chip" data-f="k-{kind}" aria-pressed="true">{label}</button>')
    if any(m.sentence for m in everything):
        chips.append('<button class="chip" data-toggle="hide-ctx" aria-pressed="true">앞뒤 문장</button>')
    if any(m.ai_context for m in everything) or any(s.overview for s in sections):
        chips.append('<button class="chip" data-toggle="hide-ai" aria-pressed="true"><span class="ai-badge">AI</span>개요·설명</button>')

    body = []
    titled = [s for s in sections if s.title]
    if len(titled) >= 2:
        base = min(s.level for s in titled)
        rows = "".join(
            f'<li style="padding-left:{(s.level - base) * 16}px"><a href="#{s.anchor}">{html.escape(s.title)}</a>'
            f'<span class="n">{s.count}</span></li>'
            for s in titled
        )
        body.append(f'<nav class="toc"><b>목차</b><ol>{rows}</ol></nav>')
    for s in sections:
        if s.title:
            tag = {1: "h2", 2: "h3"}.get(s.level, "h4")
            body.append(f'<{tag} id="{s.anchor}">{html.escape(s.title)}</{tag}>')
        if s.overview:
            body.append(f'<div class="overview"><span class="ai-badge">AI</span><b>개요</b> {html.escape(s.overview)}</div>')
        for m in s.marks:
            body.append(_html_item(m, labels, show_path))
    if not marks:
        body.append('<p class="empty">표시한 부분을 찾지 못했습니다.</p>')

    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} 필기 요약</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap">
<style>{CSS}</style></head>
<body><main>
<header><h1>{html.escape(title)}</h1>
<div class="sub">필기 요약 · {html.escape(stats_line(marks))} · 원본 {html.escape(source_name)}</div></header>
<nav class="toolbar">{''.join(chips)}</nav>
{''.join(body)}
</main><script>{JS}</script></body></html>
"""


def _path(m: Mark, show_path: bool) -> str:
    if not (show_path and m.heading_path):
        return ""
    return f'<span class="path">{html.escape(" › ".join(m.heading_path))}</span> · '


def _html_item(m: Mark, labels: dict[str, str], show_path: bool = False) -> str:
    if m.kind in (HANDWRITING, NOTE):
        return _html_note(m, solo=True, show_path=show_path)
    k = color_key(m.color)
    filt = f"c-{k}"
    if m.sentence:
        inner = '<div class="text">' + "".join(
            f"<mark>{html.escape(t)}</mark>" if hl else f'<span class="ctx">{html.escape(t)}</span>' for t, hl in m.sentence
        ) + "</div>"
    else:
        inner = f'<div class="text"><mark>{html.escape(m.text)}</mark></div>' if m.text else ""
    if m.text and m.confidence in ("medium", "low"):
        inner += '<span class="warn">⚠ AI가 읽은 글 · 원본 확인</span>'
    if m.ai_context:
        inner += f'<div class="aictx"><span class="ai-badge">AI</span>{html.escape(m.ai_context)}</div>'
    img = _img(m)
    notes = ""
    if m.notes:
        notes = '<ul class="notes">' + "".join(_html_note(n) for n in m.notes) + "</ul>"
    return (
        f'<article class="item {m.kind}" style="--c:{color_css(m.color)}" data-filter="{filt}">'
        f'{inner}{img}<div class="meta">{_path(m, show_path)}p.{m.page_no} · {html.escape(_label(m, labels))}</div>{notes}</article>'
    )


def _html_note(m: Mark, solo: bool = False, show_path: bool = False) -> str:
    icon = "✍️" if m.kind == HANDWRITING else "📝"
    tag = "div" if solo else "li"
    cls = "note solo" if solo else "note"
    text = html.escape(m.body)
    if m.kind == HANDWRITING and text:
        text = f'<span class="hand">{text}</span>'
    warn = ""
    if m.kind == HANDWRITING and m.transcription and m.confidence in ("medium", "low") and not m.is_symbol:
        detail = f" ({', '.join(m.unclear)})" if m.unclear else ""
        warn = f'<span class="warn">⚠ 애매함{html.escape(detail)}</span>'
    meta = f'<div class="meta">{_path(m, show_path)}p.{m.page_no} · {KIND_LABELS[m.kind]}</div>' if solo else ""
    return (
        f'<{tag} class="{cls}" data-icon="{icon}" data-filter="k-{m.kind}">'
        f'<div class="text">{text}{warn}</div>{_img(m)}{meta}</{tag}>'
    )


def _img(m: Mark) -> str:
    if not (m.show_image and m.image):
        return ""
    b64 = base64.b64encode(m.image).decode("ascii")
    return f'<img class="orig" alt="p.{m.page_no} 원본" src="data:image/png;base64,{b64}">'


# ── JSON ───────────────────────────────────────────────────────────────

def to_json(title: str, sections: list[Section], labels: dict[str, str]) -> str:
    def conv(m: Mark) -> dict:
        d = {
            "page": m.page_no,
            "kind": m.kind,
            "source": m.source,
            "color": color_key(m.color) if m.color else None,
            "text": m.text or None,
            "transcription": m.transcription,
            "confidence": m.confidence,
            "unclear": m.unclear or None,
            "rect": [round(v, 1) for v in m.rect],
            "sentence": "".join(t for t, _ in m.sentence) or None,
            "heading_path": m.heading_path or None,
            "ai_context": m.ai_context or None,
        }
        if m.notes:
            d["notes"] = [conv(n) for n in m.notes]
        return {k: v for k, v in d.items() if v is not None}

    data = {
        "title": title,
        "labels": labels,
        "sections": [
            {k: v for k, v in {"title": s.title, "level": s.level, "overview": s.overview or None,
                               "items": [conv(m) for m in s.marks]}.items() if v is not None}
            for s in sections
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2)
