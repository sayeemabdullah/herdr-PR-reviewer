// Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-test-"));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
const { CONFIG_FILE, loadConfig, settingsFor, agentArgv } = await import("../src/lib.js");
const S = await import("../src/settings.js");

test("first read creates config.json from the example, without the placeholder repos", () => {
  const raw = S.readRaw();
  assert.ok(fs.existsSync(CONFIG_FILE));
  assert.deepEqual(S.repoList(raw), []);
});

test("changing the model is saved and reaches the claude command", () => {
  const raw = S.readRaw();
  S.setValue(raw, "model", "sonnet");
  S.setValue(raw, "effort", "medium");
  S.writeRaw(raw);
  const cfg = loadConfig();
  assert.deepEqual(agentArgv(["claude", "-p"], cfg), ["claude", "-p", "--model", "sonnet", "--effort", "medium"]);
});

test("a value equal to the default is removed from the file", () => {
  const raw = S.readRaw();
  S.setValue(raw, "model", "opus");
  assert.equal(raw.model, undefined);
  assert.equal(S.effective(raw, "model"), "opus");
});

test("unknown keys in the file are kept", () => {
  const raw = S.readRaw();
  raw.instructions = "Focus on security.";
  S.writeRaw(raw);
  const again = S.readRaw();
  S.setValue(again, "pollSeconds", 300);
  S.writeRaw(again);
  assert.equal(S.readRaw().instructions, "Focus on security.");
});

test("cycling choices wraps, and a custom value goes back to the first", () => {
  assert.equal(S.cycle(S.EFFORTS, "max"), "low");
  assert.equal(S.cycle(S.EFFORTS, "low", -1), "max");
  assert.equal(S.cycle(S.MODELS, "claude-opus-5-5"), "opus");
});

test("numbers are checked against limits", () => {
  const f = S.FIELDS.find((x) => x.key === "maxParallel");
  assert.equal(S.parseNumber(f, " 3 "), 3);
  assert.throws(() => S.parseNumber(f, "0"), /between 1 and 8/);
  assert.throws(() => S.parseNumber(f, "2.5"), /whole number/);
});

test("repos: add by name or URL, no duplicates, per-repo overrides, remove", () => {
  const raw = S.readRaw();
  S.addRepo(raw, "https://github.com/acme/api.git");
  S.addRepo(raw, "acme/web");
  assert.equal(S.parseRepo("github.com/acme/api/pull/3"), "acme/api");
  assert.throws(() => S.addRepo(raw, "ACME/api"), /already listed/);
  assert.throws(() => S.addRepo(raw, "not a repo"), /owner\/repo/);
  S.setRepoValue(raw, "acme/api", "review", "all");
  S.setRepoValue(raw, "acme/api", "model", "haiku");
  S.setRepoValue(raw, "acme/api", "finalWord", false);
  S.writeRaw(raw);
  const cfg = loadConfig();
  const api = settingsFor(cfg, "acme/api");
  assert.equal(api.review, "all");
  assert.equal(api.finalWord, false);
  assert.equal(api.model, "haiku");
  assert.equal(settingsFor(cfg, "acme/web").model, "sonnet"); // the global one set earlier

  const back = S.readRaw();
  S.setRepoValue(back, "acme/api", "model", undefined);
  S.removeRepo(back, "acme/web");
  S.writeRaw(back);
  assert.deepEqual(S.repoList(S.readRaw()), [{ repo: "acme/api", review: "all", finalWord: false }]);
});

test("a change that would break the config is rolled back", () => {
  const before = fs.readFileSync(CONFIG_FILE, "utf8");
  const raw = S.readRaw();
  raw.repos = [{ repo: "acme/api", review: "sometimes" }];
  assert.throws(() => S.writeRaw(raw), /"review" must be/);
  assert.equal(fs.readFileSync(CONFIG_FILE, "utf8"), before);
});
