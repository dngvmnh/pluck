/** buildArgs: the paid Music processing must be gated on req.music, and Audio mode
 * without Music must produce plain audio (not video).
 * Port of tests/test_download_opts.py — yt_dlp option dicts are CLI args here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./helpers.js";

const { parseDownloadReq, OutputMode } = await import("../src/models.js");
const { buildArgs } = await import("../src/pipelines/download.js");

function args(kw = {}) {
  return buildArgs(parseDownloadReq({ url: "u", ...kw }), "/tmp");
}

function fmtOf(a) {
  return a[a.indexOf("--format") + 1];
}

test("audio without music is plain audio", () => {
  const a = args({ output: OutputMode.AUDIO, choice: "best", music: false });
  assert.equal(fmtOf(a), "ba[ext=m4a]/ba/b");      // audio, NOT video (bv*+ba)
  assert.ok(!a.includes("--embed-thumbnail"));      // no paid music tagging
  assert.ok(!a.includes("--write-thumbnail"));
});

test("audio with music does full tagging", () => {
  const a = args({ output: OutputMode.AUDIO, choice: "best", music: true });
  assert.equal(fmtOf(a), "ba/b");
  for (const flag of ["--extract-audio", "--embed-thumbnail", "--embed-metadata", "--write-thumbnail"]) {
    assert.ok(a.includes(flag), `missing ${flag}`);
  }
});

test("video is unaffected", () => {
  const a = args({ output: OutputMode.VIDEO, choice: "best" });
  assert.equal(fmtOf(a), "bv*+ba/b");
  assert.ok(!a.includes("--embed-thumbnail"));
});

test("subs add embed flags (non-music)", () => {
  const a = args({ output: OutputMode.VIDEO, choice: "best", subs: true });
  for (const flag of ["--write-subs", "--write-auto-subs", "--embed-subs"]) {
    assert.ok(a.includes(flag), `missing ${flag}`);
  }
});

test("sponsorblock adds remove flag", () => {
  const a = args({ output: OutputMode.VIDEO, choice: "best", sponsorblock: true });
  const i = a.indexOf("--sponsorblock-remove");
  assert.ok(i >= 0);
  assert.ok(a[i + 1].includes("sponsor"));
});
