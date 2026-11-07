"""기기 안 AI(태블릿·폰의 Apple 기기 안 AI / Gemini Nano)에게 일감을 넘기고 답을 받아 넣는 흐름."""

import json
import time
import urllib.request
from pathlib import Path

from pdfsummary import device_ai
from pdfsummary.cli import main
from pdfsummary.device_ai import parse_answer

from test_server import call, server  # noqa: F401  (서버 모드 고정물)


def test_parse_answer_plain():
    ov, items = parse_answer("개요: 이 단원은 효소를 다룹니다. 표시는 핵심 정의입니다.\n1: 앞에서 촉매를 설명한 뒤 나온 정의.\n2: -\n", 2)
    assert ov.startswith("이 단원은 효소")
    assert items == {1: "앞에서 촉매를 설명한 뒤 나온 정의."}


def test_parse_answer_tolerates_small_model_styles():
    text = """**개요**: 네트워크 관리 방법을 다룹니다.
이어서 SNMP의 역할을 설명합니다.

[1]: SNMP가 무엇인지 처음 나오는 부분입니다.
2) 없음
3. 앞 표시에 이어
   관리 대상 장치를 설명합니다.
7: 범위를 벗어난 번호는 버립니다.
- 3: (중복 번호는 뒤의 것)"""
    ov, items = parse_answer(text, 3)
    assert ov == "네트워크 관리 방법을 다룹니다. 이어서 SNMP의 역할을 설명합니다."
    assert items[1].startswith("SNMP가")
    assert 2 not in items
    assert items[3] == "(중복 번호는 뒤의 것)"
    assert 7 not in items


def test_parse_answer_garbage():
    assert parse_answer("", 3) == ("", {})
    assert parse_answer("모르겠습니다.", 2) == ("", {})


def _run_device(textbook, out):
    rc = main([str(textbook), "-o", str(out), "--format", "html,md,json", "--context", "device", "--no-ai"],
              log=lambda s: None, progress=lambda *a: None)
    assert rc == 0
    return json.loads((out / "기기AI_일감.json").read_text(encoding="utf-8"))["tasks"]


def test_cli_device_tasks_fit_on_device_models(textbook, tmp_path):
    out = tmp_path / "out"
    tasks = _run_device(textbook, out)
    assert tasks, "일감이 없음"
    for t in tasks:
        # 기기 안 AI는 한 번에 4천 토큰쯤(한글은 대략 한 글자가 한 토큰): 지시+일감+답이 들어가야 한다
        assert len(t["instructions"]) + len(t["prompt"]) < 2800, len(t["prompt"])
        assert len(t["fallback"]) <= len(t["prompt"])
        assert "[1]" in t["prompt"] or "## " in t["prompt"]
    # AI 없이 만든 요약은 이미 있다 (앱은 이것을 먼저 보여 줄 수 있음)
    html = (out / "요약.html").read_text(encoding="utf-8")
    assert "AI</span>" not in html
    assert (out / device_ai.STATE_FILE).exists()


def test_answers_are_rendered(textbook, tmp_path):
    out = tmp_path / "out"
    tasks = _run_device(textbook, out)
    answers = {}
    with_marks = 0
    for t in tasks:
        lines = []
        if "개요:" in t["prompt"]:
            lines.append(f"개요: {t['id']} 단원의 개요입니다.")
        if "[1]" in t["prompt"]:
            lines.append(f"1: {t['id']} 첫 표시의 연결 설명.")
            with_marks += 1
        answers[t["id"]] = "\n".join(lines)
    st = device_ai.load_state(out)
    n_over, n_note = device_ai.apply_answers(st, answers)
    assert n_note == with_marks and n_over >= 1
    device_ai.render(out, st)
    html = (out / "요약.html").read_text(encoding="utf-8")
    assert "첫 표시의 연결 설명." in html
    assert "단원의 개요입니다." in html
    md = (out / "요약.md").read_text(encoding="utf-8")
    assert "첫 표시의 연결 설명" in md
    data = json.loads((out / "요약.json").read_text(encoding="utf-8"))
    assert "첫 표시의 연결 설명" in json.dumps(data, ensure_ascii=False)


def test_server_device_flow(server, textbook):  # noqa: F811
    s, b, _ = call(server, "/api/upload?name=tb.pdf", raw=Path(textbook).read_bytes(), method="PUT")
    fid = json.loads(b)["id"]
    s, b, _ = call(server, "/api/run", data={"file": fid, "options": {"style": "list", "context": "device"}})
    job = json.loads(b)["job"]
    for _ in range(600):
        st = json.loads(call(server, f"/api/job/{job}")[1])
        if st["status"] != "running":
            break
        time.sleep(0.05)
    assert st["status"] == "done", st
    s, b, _ = call(server, f"/api/job/{job}/device-tasks")
    tasks = json.loads(b)["tasks"]
    assert s == 200 and tasks
    answers = {t["id"]: "개요: 서버를 거쳐 넣은 개요.\n1: 서버를 거쳐 넣은 설명." for t in tasks}
    answers["없는일감"] = "1: 무시됨"
    s, b, _ = call(server, f"/api/job/{job}/device-answers", data={"answers": answers})
    res = json.loads(b)
    assert s == 200 and res["notes"] == sum("[1]" in t["prompt"] for t in tasks) and res["overviews"] >= 1
    s, b, _ = call(server, "/r/" + job + "/" + urllib.request.quote("요약.html"))
    assert "서버를 거쳐 넣은 설명." in b.decode("utf-8")
    # 잘못된 요청
    assert call(server, f"/api/job/{job}/device-answers", data={"answers": "x"})[0] == 400
    assert call(server, "/api/job/nope/device-tasks")[0] == 404
    assert call(server, f"/api/job/{job}/device-tasks", code="wrong-code-xxxx")[0] == 403
