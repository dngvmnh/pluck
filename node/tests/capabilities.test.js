/** Capability detection: cached shape + override hook (the dep-chain probes
 * themselves run through PLUCK_PYTHON; see src/capabilities.js).
 * Port of tests/test_capabilities.py adapted to the subprocess-probe design.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./helpers.js";

const caps = await import("../src/capabilities.js");

afterEach(() => caps.resetCapabilities(null));

test("capabilities shape", () => {
  const c = caps.capabilities();
  for (const k of ["ffmpeg", "aria2c", "whisper", "demucs", "ytdlp"]) {
    assert.ok(k in c, `missing ${k}`);
  }
  assert.equal(typeof c.demucs, "boolean");
  assert.equal(typeof c.whisper, "boolean");
});

test("has() reads the cached table", () => {
  caps.resetCapabilities({ ffmpeg: true, whisper: false, demucs: false });
  assert.equal(caps.has("ffmpeg"), true);
  assert.equal(caps.has("whisper"), false);
  assert.equal(caps.has("nonexistent"), false);
});

test("which() finds binaries on PATH", () => {
  assert.notEqual(caps.which("node"), null);
  assert.equal(caps.which("definitely-not-a-real-binary-xyz"), null);
});
