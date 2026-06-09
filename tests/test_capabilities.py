"""Capability detection must require the WHOLE dependency chain so a feature reported
available actually runs (e.g. Demucs needs torchcodec, else the TorchCodec runtime error)."""
import pluck.capabilities as caps


def test_demucs_requires_full_chain_incl_torchcodec(monkeypatch):
    present = {"demucs", "torch", "torchaudio"}  # torchcodec missing
    monkeypatch.setattr(caps, "_has_module", lambda n: n in present)
    assert caps._demucs_ok() is False            # hidden -> route 400s before charging
    present.add("torchcodec")
    assert caps._demucs_ok() is True


def test_whisper_requires_ctranslate2(monkeypatch):
    present = {"faster_whisper"}                  # backend missing
    monkeypatch.setattr(caps, "_has_module", lambda n: n in present)
    assert caps._whisper_ok() is False
    present.add("ctranslate2")
    assert caps._whisper_ok() is True


def test_capabilities_shape():
    c = caps.capabilities()
    assert set(c) >= {"ffmpeg", "aria2c", "whisper", "demucs"}
    assert isinstance(c["demucs"], bool) and isinstance(c["whisper"], bool)
