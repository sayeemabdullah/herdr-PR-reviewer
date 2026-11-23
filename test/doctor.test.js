// The Claude check: a stub `claude` on PATH, so each way the real one can fail is covered. Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-doctor-")));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
process.env.HERDR_PLUGIN_STATE_DIR = path.join(tmp, "state");
const { loadConfig, settingsFor } = await import("../src/lib.js");
const { smokeReview, diagnose, hintFor } = await import("../src/doctor.js");

const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
const script = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env node\n${body}`); fs.chmodSync(path.join(bin, name), 0o755); };
const GOOD = JSON.stringify({ verdict: "request_changes", summary: "add() subtracts instead of adding.", comments: [{ path: "src/math.js", line: 2, body: "Use a + b." }] });
script("gh", `process.exit(process.argv[2] === "auth" ? 0 : 1);`);
// The stub's behaviour is picked per test with CLAUDE_MODE.
script("claude", `
const mode = process.env.CLAUDE_MODE || "good";
require("fs").readFileSync(0, "utf8");
if (mode === "good") console.log(${JSON.stringify(GOOD)});
else if (mode === "login") { process.stderr.write("Not logged in. Run claude and sign in"); process.exit(1); }
else if (mode === "prose") console.log("Sure! Here is my review, but no JSON.");
else if (mode === "hang") setTimeout(() => {}, 60000);
`);
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
const settings = () => settingsFor(loadConfig(), "");
const mode = async (m, fn) => { process.env.CLAUDE_MODE = m; try { return await fn(); } finally { delete process.env.CLAUDE_MODE; } };

test("a working Claude passes and is credited with spotting the planted bug", async () => {
  const r = await smokeReview(settings());
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "request_changes");
  assert.equal(r.foundBug, true);
});

test("a Claude that isn't signed in fails with the sign-in step", async () => {
  const r = await mode("login", () => smokeReview(settings()));
  assert.equal(r.ok, false);
  assert.match(r.error, /Not logged in/);
  assert.match(r.hint, /run `claude`/);
});

test("an answer without JSON fails and says so", async () => {
  const r = await mode("prose", () => smokeReview(settings()));
  assert.equal(r.ok, false);
  assert.match(r.hint, /didn't reply with the JSON/);
});

test("a Claude that hangs (e.g. waiting for sign-in) times out with a hint", async () => {
  const r = await mode("hang", () => smokeReview(settings(), { timeoutMs: 700 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out/);
  assert.match(r.hint, /sign in/);
});

test("a missing Claude says to install it", async () => {
  const s = settings();
  const r = await smokeReview({ ...s, agent: { ...s.agent, command: ["no-such-claude-binary", "-p"] } }, { timeoutMs: 700 });
  assert.equal(r.ok, false);
  assert.match(r.hint, /install Claude Code/);
});

test("the check leaves no temp files behind", async () => {
  await smokeReview(settings());
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith("doctor-")) : [], []);
});

test("diagnose is ok only when GitHub and Claude both work", async () => {
  const lines = [];
  const good = await diagnose({ cfg: loadConfig(), log: (l) => lines.push(l) });
  assert.equal(good.ok, true);
  assert.ok(lines.some((l) => l.startsWith("✓ Claude Code")));
  const bad = await mode("login", () => diagnose({ cfg: loadConfig() }));
  assert.equal(bad.ok, false);
});

test("hintFor points at the likely fix", () => {
  assert.match(hintFor("unknown option --foo"), /rejected a flag/);
  assert.match(hintFor("Unauthorized"), /sign in/);
});
