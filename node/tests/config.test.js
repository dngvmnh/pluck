/** The default session secret must fail closed in production (else session forgery).
 * Port of tests/test_config.py — runs config import in a child process.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_URL = pathToFileURL(path.join(HERE, "..", "src", "config.js")).href;

function importConfig(env) {
  return spawnSync(process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(CONFIG_URL)})`],
    { env: { ...env }, encoding: "utf-8", windowsHide: true });
}

test("production without secret fails closed", () => {
  const env = { ...process.env, MYTHOS_ENV: "production" };
  delete env.SESSION_SECRET;
  const r = importConfig(env);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes("SESSION_SECRET"));
});

test("production with secret ok", () => {
  const env = { ...process.env, MYTHOS_ENV: "production", SESSION_SECRET: "x".repeat(64) };
  const r = importConfig(env);
  assert.equal(r.status, 0, r.stderr);
});

test("dev default secret ok", () => {
  const env = { ...process.env };
  delete env.SESSION_SECRET;
  delete env.MYTHOS_ENV;
  const r = importConfig(env);
  assert.equal(r.status, 0, r.stderr);
});
