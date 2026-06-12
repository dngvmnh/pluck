/** Pure yt-dlp helper functions. Port of tests/test_ytdlp.py. */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./helpers.js";

const { buildQualities, fmtDuration, formatSelector, parseHms } = await import("../src/ytdlp.js");

test("parseHms", () => {
  assert.equal(parseHms("90"), 90);
  assert.equal(parseHms("1:30"), 90);
  assert.equal(parseHms("1:02:03"), 3723);
  assert.equal(parseHms(""), null);
  assert.equal(parseHms(null), null);
  assert.equal(parseHms("abc"), null);
});

test("fmtDuration", () => {
  assert.equal(fmtDuration(0), "");
  assert.equal(fmtDuration(65), "1:05");
  assert.equal(fmtDuration(3725), "1:02:05");
});

test("formatSelector", () => {
  assert.deepEqual(formatSelector("best"), ["bv*+ba/b", []]);
  const [, extra] = formatSelector("audio-mp3");
  assert.ok(extra.includes("--audio-format") && extra.includes("mp3"));
  const [fmt] = formatSelector("1080");
  assert.ok(fmt.includes("height<=1080"));
});

test("buildQualities", () => {
  const info = { formats: [{ height: 720 }, { height: 1080 }, { height: 2160 }] };
  const qs = buildQualities(info);
  const ids = qs.map((q) => q.id);
  assert.equal(ids[0], "best");
  assert.ok(ids.includes("2160") && ids.includes("1080") && ids.includes("720"));
  assert.ok(ids.includes("audio-m4a") && ids.includes("audio-mp3"));
  // 8K not offered when source maxes at 2160
  assert.ok(!ids.includes("4320"));
  // 4K labelled
  assert.ok(qs.some((q) => q.id === "2160" && q.label === "4K"));
});
