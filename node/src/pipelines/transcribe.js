/** AI transcription via faster-whisper -> .srt + .txt (optional dependency).
 *
 * Mirrors pluck/pipelines/transcribe.py. The Python app imports faster_whisper
 * in-process; here it runs through PLUCK_PYTHON as a child process. The download
 * route rejects this mode with 400 when the capability is absent; this is the backstop.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { PYTHON, WHISPER_MODEL } from "../config.js";
import { downloadSource, trimIfRequested, unlinkQuiet, zipFiles } from "./base.js";

const execFileP = promisify(execFile);

// Writes <src>.srt + <src>.txt next to the source, exactly like the Python pipeline.
const WHISPER_SCRIPT = `
import sys
from pathlib import Path

from faster_whisper import WhisperModel

src = Path(sys.argv[1]); model_name = sys.argv[2]

def fmt_ts(seconds):
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

model = WhisperModel(model_name, device="cpu", compute_type="int8")
segments, _info = model.transcribe(str(src))

srt = src.with_suffix(".srt"); txt = src.with_suffix(".txt")
with srt.open("w", encoding="utf-8") as fsrt, txt.open("w", encoding="utf-8") as ftxt:
    for i, seg in enumerate(segments, 1):
        text = seg.text.strip()
        fsrt.write(f"{i}\\n{fmt_ts(seg.start)} --> {fmt_ts(seg.end)}\\n{text}\\n\\n")
        ftxt.write(text + "\\n")
`;

export async function transcribeFile(src) {
  let result;
  try {
    result = await execFileP(PYTHON, ["-c", WHISPER_SCRIPT, src, WHISPER_MODEL],
      { windowsHide: true, timeout: 3_600_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = String(e.stderr || e.message || "");
    if (/No module named/i.test(err)) {
      throw new Error(
        "Transcription unavailable — Whisper backend not installed/working. " +
        "Run: pip install -r requirements-ml.txt");
    }
    const lines = err.trim().split(/\r?\n/);
    throw new Error(`Transcription failed: ${(lines[lines.length - 1] || "whisper error").slice(0, 160)}`);
  }
  void result;
  const base = src.slice(0, -path.extname(src).length);
  const srt = base + ".srt", txt = base + ".txt";
  if (!existsSync(srt) || !existsSync(txt)) {
    throw new Error("Transcription failed: no output produced");
  }
  return [srt, txt];
}

export async function run(ctx) {
  let src = await downloadSource(ctx, { audioOnly: true });
  src = await trimIfRequested(src, ctx.req);
  ctx.update({ status: "processing" });
  const outs = await transcribeFile(src);
  unlinkQuiet(src);
  const stem = path.basename(outs[0], path.extname(outs[0]));
  return zipFiles(outs, path.join(ctx.jobDir, stem + "-transcript.zip"));
}
