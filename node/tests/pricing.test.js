/** Pricing is the single source of truth — verify each option + combinations.
 * Port of tests/test_pricing.py. */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./helpers.js";

const { parseDownloadReq, OutputMode } = await import("../src/models.js");
const { PRICING, costFor } = await import("../src/pricing.js");

const BASE = PRICING.base;

function C(kw = {}) {
  return costFor(parseDownloadReq({ url: "u", ...kw }));
}

test("base download", () => {
  assert.deepEqual(C(), [BASE, "download"]);
});

test("trim adds one", () => {
  const [credits, reason] = C({ start: "0:05", end: "0:10" });
  assert.equal(credits, BASE + PRICING.trim);
  assert.ok(reason.includes("trim"));
});

test("4k and 8k", () => {
  assert.equal(C({ choice: "2160" })[0], BASE + PRICING["4k"]);
  assert.equal(C({ choice: "4320" })[0], BASE + PRICING["8k"]);
});

test("audio modifiers", () => {
  assert.equal(C({ subs: true })[0], BASE + PRICING.subtitles);
  assert.equal(C({ sponsorblock: true })[0], BASE + PRICING.sponsorblock);
  assert.equal(C({ music: true })[0], BASE + PRICING.music);
});

test("output modes", () => {
  assert.equal(C({ output: OutputMode.GIF })[0], BASE + PRICING.gif);
  assert.equal(C({ output: OutputMode.CONVERT, convert_to: "mp3" })[0], BASE + PRICING.convert);
  assert.equal(C({ output: OutputMode.CHAPTERS })[0], BASE + PRICING.chapters);
  assert.equal(C({ output: OutputMode.REMASTER })[0], BASE + PRICING.remaster);
  assert.equal(C({ output: OutputMode.TRANSCRIPT })[0], BASE + PRICING.transcribe);
  assert.equal(C({ output: OutputMode.STEMS })[0], BASE + PRICING.stems);
});

test("combination", () => {
  const [credits, reason] = C({ choice: "2160", subs: true, sponsorblock: true, start: "1:00", end: "2:00" });
  assert.equal(credits, BASE + PRICING["4k"] + PRICING.subtitles + PRICING.sponsorblock + PRICING.trim);
  for (const tag of ["download", "4k", "subtitles", "sponsorblock", "trim"]) {
    assert.ok(reason.includes(tag), `missing ${tag}`);
  }
});

test("gif with trim", () => {
  const [credits] = C({ output: OutputMode.GIF, start: "0:00", end: "0:05" });
  assert.equal(credits, BASE + PRICING.gif + PRICING.trim);
});

test("convert does not charge unapplied modifiers", () => {
  // the convert pipeline never applies subs/sponsorblock, so they must not be billed
  const [credits, reason] = C({ output: OutputMode.CONVERT, convert_to: "mp3", subs: true, sponsorblock: true });
  assert.equal(credits, BASE + PRICING.convert);
  assert.ok(!reason.includes("subtitles") && !reason.includes("sponsorblock"));
});

test("chapters does not charge sponsorblock", () => {
  const [credits, reason] = C({ output: OutputMode.CHAPTERS, sponsorblock: true });
  assert.equal(credits, BASE + PRICING.chapters);
  assert.ok(!reason.includes("sponsorblock"));
});
