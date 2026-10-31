import json
from types import SimpleNamespace

from pdfsummary.ai import AIReader
from pdfsummary.models import HANDWRITING, HIGHLIGHT, Mark


class FakeMessages:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def create(self, **kw):
        self.calls.append(kw)
        data = self.replies.pop(0)
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps(data, ensure_ascii=False))])


def reader_with(replies, tmp_path):
    r = AIReader(cache_path=tmp_path / "cache.json", workers=1)
    fake = FakeMessages(replies)
    r.client = SimpleNamespace(beta=SimpleNamespace(messages=fake))
    r.disabled_reason = None
    return r, fake


def test_transcribe_and_cache(tmp_path):
    m = Mark(0, HANDWRITING, (0, 0, 10, 10), "annotation", image=b"png-1", context="명반응에서는 물이 분해되어")
    r, fake = reader_with([{"kind": "handwriting", "text": "물의 광분해", "confidence": "medium", "unclear_parts": ["광"]}], tmp_path)
    r.transcribe_handwriting([m])
    assert (m.transcription, m.confidence, m.unclear) == ("물의 광분해", "medium", ["광"])
    req = fake.calls[0]
    assert req["model"] == "claude-opus-5-5"
    assert req["output_config"]["format"]["type"] == "json_schema"
    assert "명반응에서는" in req["messages"][0]["content"][1]["text"]

    # 같은 이미지는 캐시에서 (API 다시 안 부름)
    m2 = Mark(0, HANDWRITING, (0, 0, 10, 10), "annotation", image=b"png-1", context="명반응에서는 물이 분해되어")
    r2, fake2 = reader_with([], tmp_path)
    r2.transcribe_handwriting([m2])
    assert m2.transcription == "물의 광분해" and fake2.calls == []


def test_symbol(tmp_path):
    m = Mark(0, HANDWRITING, (0, 0, 10, 10), "annotation", image=b"png-2")
    r, _ = reader_with([{"kind": "symbol", "text": "(별표)", "confidence": "high", "unclear_parts": []}], tmp_path)
    r.transcribe_handwriting([m])
    assert m.is_symbol and m.transcription == "(별표)"


def test_read_scanned_highlight(tmp_path):
    m = Mark(2, HIGHLIGHT, (0, 0, 10, 10), "scan", image=b"png-3")
    r, _ = reader_with([{"text": "코돈은 연속된 세 개의 염기로", "confidence": "high"}], tmp_path)
    r.read_highlighted([m])
    assert m.text == "코돈은 연속된 세 개의 염기로"


def test_refusal_leaves_image(tmp_path):
    m = Mark(0, HANDWRITING, (0, 0, 10, 10), "annotation", image=b"png-4")
    r, fake = reader_with([], tmp_path)
    fake.create = lambda **kw: SimpleNamespace(stop_reason="refusal", content=[])
    r.transcribe_handwriting([m])
    assert m.transcription is None
