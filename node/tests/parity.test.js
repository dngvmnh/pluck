/** Regression tests for the Python↔Node parity fixes surfaced by the audit:
 * argument-injection hardening, billing-sensitive parsing, and strict validation. */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { makeClient } from "./helpers.js";

const { parseHms, formatSelector } = await import("../src/ytdlp.js");
const { parseDownloadReq, ValidationError } = await import("../src/models.js");
const { costFor } = await import("../src/pricing.js");

// ---- parseHms / trim-surcharge parity ---------------------------------------
test("parseHms matches Python float(): rejects hex, accepts plain/colon", () => {
  assert.equal(parseHms("90"), 90);
  assert.equal(parseHms("1:30"), 90);
  assert.equal(parseHms("0x10"), null);   // JS Number('0x10')=16 would wrongly charge trim
  assert.equal(parseHms("abc"), null);
  assert.equal(parseHms(""), null);
  assert.equal(parseHms("1e3"), 1000);    // Python float('1e3') == 1000.0
});

test("hex start does not add the trim surcharge", () => {
  const [credits] = costFor(parseDownloadReq({ url: "u", start: "0x10" }));
  const [base] = costFor(parseDownloadReq({ url: "u" }));
  assert.equal(credits, base); // no +trim for an unparseable time
});

// ---- formatSelector strict choice -------------------------------------------
test("formatSelector rejects partial-integer quality strings", () => {
  assert.throws(() => formatSelector("720p"), /unknown quality choice/);
  assert.throws(() => formatSelector("5x"), /unknown quality choice/);
  const [fmt] = formatSelector("1080");
  assert.ok(fmt.includes("height<=1080"));
});

// ---- strict request validation ----------------------------------------------
test("non-string url is rejected (no silent String() coercion)", () => {
  assert.throws(() => parseDownloadReq({ url: 123 }), ValidationError);
  assert.throws(() => parseDownloadReq({ url: { a: 1 } }), ValidationError);
  assert.throws(() => parseDownloadReq({ urls: ["ok", null] }), ValidationError);
});

test("non-numeric min_minutes is rejected", () => {
  assert.throws(() => parseDownloadReq({ url: "u", min_minutes: "abc" }), ValidationError);
  assert.equal(parseDownloadReq({ url: "u", min_minutes: 3 }).min_minutes, 3);
  assert.equal(parseDownloadReq({ url: "u" }).min_minutes, null);
});

// ---- end-to-end: validation maps to 422 and never charges -------------------
const client = await makeClient();
after(() => client.close());

test("non-string url 422s before charging", async () => {
  // String() coercion previously created a charged job against "[object Object]".
  client.charges.length = 0;
  const r = await client.post("/api/download", { url: { evil: 1 } });
  assert.equal(r.status, 422);
  assert.equal(client.charges.length, 0);
});

test("non-numeric min_minutes 422s before charging", async () => {
  client.charges.length = 0;
  const r = await client.post("/api/download", { url: "https://x/v", playlist: true, min_minutes: "abc" });
  assert.equal(r.status, 422);
  assert.equal(client.charges.length, 0);
});
