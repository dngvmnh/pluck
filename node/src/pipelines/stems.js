/** Stem separation via Demucs -> vocals/drums/bass/other, delivered as a .zip
 * (optional dependency). Mirrors pluck/pipelines/stems.py — `python -m demucs`
 * as a child process, same as the Python app. */
import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { DEMUCS_MODEL, PYTHON } from "../config.js";
import { downloadSource, trimIfRequested, zipFiles } from "./base.js";

const execFileP = promisify(execFile);

export async function separateStems(src, outDir) {
  try {
    await execFileP(PYTHON, ["-m", "demucs", "-n", DEMUCS_MODEL, "--out", outDir, src],
      { windowsHide: true, timeout: 3_600_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = String(e.stderr || e.message || "");
    if (/No module named/i.test(err)) {
      throw new Error(
        "Stem separation unavailable — Demucs not installed/working. " +
        "Run: pip install -r requirements-ml.txt");
    }
    if (/torchcodec/i.test(err)) {
      throw new Error(
        "Stem separation needs 'torchcodec' to decode audio (torchaudio>=2.1). " +
        "Install it: pip install torchcodec  (see requirements-ml.txt)");
    }
    const lines = err.trim().split(/\r?\n/);
    throw new Error("Demucs failed: " + (lines[lines.length - 1] || "no output").slice(0, 160));
  }
  // demucs writes to <out_dir>/<model>/<track>/{vocals,drums,bass,other}.wav
  const stems = globSync(path.join(outDir, DEMUCS_MODEL, "**", "*.wav")).sort();
  if (!stems.length) throw new Error("demucs produced no stems");
  return stems;
}

export async function run(ctx) {
  let src = await downloadSource(ctx, { audioOnly: true });
  src = await trimIfRequested(src, ctx.req);
  ctx.update({ status: "processing" });
  const stems = await separateStems(src, ctx.jobDir);
  const stem = path.basename(src, path.extname(src));
  return zipFiles(stems, path.join(ctx.jobDir, stem + "-stems.zip"));
}
