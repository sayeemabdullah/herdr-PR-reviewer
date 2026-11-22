// Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-test-"));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
const { agentArgv, loadConfig } = await import("../src/lib.js");

test("reviews use Opus at high effort by default (--restricted ignores the user's model setting)", () => {
  const cfg = loadConfig();
  const argv = agentArgv(cfg.agent.codeCommand, cfg);
  assert.deepEqual(argv.slice(-4), ["--model", "opus", "--effort", "high"]);
});

test("model and effort can be changed, also per repo", () => {
  assert.deepEqual(agentArgv(["claude", "-p"], { model: "sonnet", effort: "medium" }),
    ["claude", "-p", "--model", "sonnet", "--effort", "medium"]);
  assert.deepEqual(agentArgv(["claude", "-p"], { model: "", effort: "" }), ["claude", "-p"], "empty = Claude's default");
});

test("a command that already picks a model is left alone", () => {
  assert.deepEqual(agentArgv(["claude", "-p", "--model", "fable"], { model: "opus", effort: "high" }),
    ["claude", "-p", "--model", "fable", "--effort", "high"]);
});

test("other AI CLIs don't get Claude flags", () => {
  assert.deepEqual(agentArgv(["codex", "exec", "-"], { model: "opus", effort: "high" }), ["codex", "exec", "-"]);
  assert.deepEqual(agentArgv(["/opt/bin/claude", "-p"], { model: "opus" }), ["/opt/bin/claude", "-p", "--model", "opus"]);
});
