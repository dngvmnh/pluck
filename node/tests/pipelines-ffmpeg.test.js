/** ffmpeg-native pipelines, tested against a locally generated clip (no network).
 * Port of tests/test_pipelines_ffmpeg.py. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";

import "./helpers.js";

const { FFMPEG } = await import("../src/config.js");
const { splitChapters } = await import("../src/pipelines/chapters.js");
const { convertFile } = await import("../src/pipelines/convert.js");
const { makeGif } = await import("../src/pipelines/gif.js");
const { remasterAudio } = await import("../src/pipelines/remaster.js");

function probeStreams(p) {
  // Return ffprobe-less stream info via ffmpeg -i stderr (ffprobe may be absent).
  const r = spawnSync(FFMPEG, ["-i", p], { encoding: "utf-8", windowsHide: true });
  return r.stderr || "";
}

function sizeOf(p) {
  return statSync(p).size;
}

let tmp, clip;
beforeEach(() => {
  // A 5s 320x240 test video with a sine audio track.
  tmp = mkdtempSync(path.join(os.tmpdir(), "pluck-ff-"));
  clip = path.join(tmp, "src.mp4");
  const r = spawnSync(FFMPEG, ["-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=5",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-shortest", clip], { encoding: "utf-8", windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(sizeOf(clip) > 0);
});

test("makeGif", async () => {
  const out = path.join(tmp, "out.gif");
  await makeGif(clip, out, 0.0, 2.0, 10, 200);
  assert.ok(sizeOf(out) > 0);
  assert.ok(probeStreams(out).includes("Video: gif"));
});

test("convert to mp3", async () => {
  const out = await convertFile(clip, "mp3");
  assert.ok(out.endsWith(".mp3") && sizeOf(out) > 0);
  assert.ok(probeStreams(out).includes("Audio: mp3"));
});

test("convert to mkv", async () => {
  const out = await convertFile(clip, "mkv");
  assert.ok(out.endsWith(".mkv") && sizeOf(out) > 0);
});

test("remaster audio", async () => {
  const out = await remasterAudio(clip);
  assert.ok(out.endsWith(".mp3") && sizeOf(out) > 0);
  assert.ok(probeStreams(out).includes("Audio: mp3"));
});

test("split chapters", async () => {
  const chapters = [
    { title: "intro", start_time: 0, end_time: 2 },
    { title: "main", start_time: 2, end_time: 5 },
  ];
  const parts = await splitChapters(clip, chapters, tmp);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => sizeOf(p) > 0));
  assert.ok(path.basename(parts[0]).startsWith("01-"));
  assert.ok(path.basename(parts[1]).startsWith("02-"));
});
