// The AI check: stub AI CLIs on PATH, so each way a real one can fail is covered. Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-doctor-")));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
process.env.HERDR_PLUGIN_STATE_DIR = path.join(tmp, "state");
const { loadConfig } = await import("../src/lib.js");
const { smokeReview, diagnose, chooseIds, hintFor } = await import("../src/doctor.js");

const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
const script = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env node\n${body}`); fs.chmodSync(path.join(bin, name), 0o755); };
const GOOD = JSON.stringify({ verdict: "request_changes", summary: "add() subtracts instead of adding.", comments: [{ path: "src/math.js", line: 2, body: "Use a + b." }] });
script("gh", `process.exit(process.argv[2] === "auth" ? 0 : 1);`);
script("claude", `console.log(${JSON.stringify(GOOD)});`);
script("codex", `console.log("I could not log in."); process.stderr.write("Not logged in. Run codex login"); process.exit(1);`);
script("gemini", `console.log("Sure! Here is my review, but no JSON.");`);
script("opencode", `setTimeout(() => {}, 60000);`);
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
const cfg = () => loadConfig();
const settings = () => ({ ...cfg(), agentIsCustom: false });

test("a working AI passes and is credited with spotting the planted bug", async () => {
  const r = await smokeReview("claude", settings());
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "request_changes");
  assert.equal(r.foundBug, true);
});

test("an AI that isn't signed in fails with the sign-in command", async () => {
  const r = await smokeReview("codex", settings());
  assert.equal(r.ok, false);
  assert.match(r.error, /Not logged in/);
  assert.match(r.hint, /codex login/);
});

test("an AI that answers without JSON fails and says so", async () => {
  const r = await smokeReview("gemini", settings());
  assert.equal(r.ok, false);
  assert.match(r.hint, /didn't reply with the JSON/);
});

test("an AI that hangs (e.g. waiting for sign-in) times out with a hint", async () => {
  const r = await smokeReview("opencode", settings(), { timeoutMs: 700 });
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out/);
  assert.match(r.hint, /opencode auth login/);
});

test("an AI that isn't installed fails without running anything", async () => {
  const r = await smokeReview("cursor", { ...settings() }, { timeoutMs: 700 });
  assert.equal(r.ok, false);
  assert.match(r.hint, /install Cursor/);
});

test("the check leaves no temp files behind", async () => {
  await smokeReview("claude", settings());
  const left = fs.existsSync(process.env.HERDR_PLUGIN_STATE_DIR) ? fs.readdirSync(process.env.HERDR_PLUGIN_STATE_DIR).filter((f) => f.startsWith("doctor-")) : [];
  assert.deepEqual(left, []);
});

test("diagnose is ok only when GitHub and every checked AI work", async () => {
  const lines = [];
  const good = await diagnose({ cfg: cfg(), ids: ["claude"], log: (l) => lines.push(l) });
  assert.equal(good.ok, true);
  assert.ok(lines.some((l) => l.startsWith("✓ Claude Code")));
  const mixed = await diagnose({ cfg: cfg(), ids: ["claude", "codex"] });
  assert.equal(mixed.ok, false);
  assert.deepEqual(mixed.results.map((r) => r.ok), [true, false]);
});

test("chooseIds: --ai, --all and the default", () => {
  assert.deepEqual(chooseIds(["--ai", "codex"], cfg()), ["codex"]);
  assert.throws(() => chooseIds(["--ai", "nope"], cfg()), /--ai must be one of/);
  assert.deepEqual(chooseIds(["--all"], cfg()), ["claude", "codex", "gemini", "opencode"]);
  assert.deepEqual(chooseIds([], cfg()), ["claude"]);
});

test("hintFor points at the likely fix", () => {
  assert.match(hintFor("gemini", "unknown option --foo"), /rejected a flag/);
  assert.match(hintFor("cursor", "Unauthorized"), /cursor-agent login/);
});
