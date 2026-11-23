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

test("minSeverity is a setting, saved only when it isn't the default, and a wrong value is refused", () => {
  const raw = S.readRaw();
  assert.ok(S.FIELDS.some((f) => f.key === "minSeverity"));
  S.setValue(raw, "minSeverity", "blocker");
  S.writeRaw(raw);
  assert.equal(loadConfig().minSeverity, "blocker");
  const again = S.readRaw();
  S.setValue(again, "minSeverity", "nit");
  S.writeRaw(again);
  assert.equal("minSeverity" in JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")), false);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")), minSeverity: "huge" }));
  assert.throws(() => loadConfig(), /minSeverity/);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")), minSeverity: "nit" }));
});

test("every setting in the panel has a default, a type and sane limits", () => {
  const keys = S.FIELDS.filter((f) => f.key).map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "no setting listed twice");
  for (const f of S.FIELDS.filter((x) => x.key)) {
    assert.notEqual(S.effective({}, f.key), undefined, `${f.key} has a default`);
    assert.ok(["bool", "choice", "number", "list", "text"].includes(f.type), f.key);
    if (f.type === "number") {
      assert.ok(f.min <= f.max, f.key);
      const d = S.effective({}, f.key);
      assert.ok(d >= f.min && d <= f.max, `${f.key} default ${d} is inside ${f.min}..${f.max}`);
    }
    if (f.type === "list") assert.ok(Array.isArray(S.effective({}, f.key)), f.key);
    if (f.type === "choice") assert.ok(f.options.includes(S.effective({}, f.key)) || f.custom, f.key);
  }
});

test("the settings you'd expect are all in the panel", () => {
  const keys = new Set(S.FIELDS.map((f) => f.key));
  for (const k of ["onlyListedRepos", "ignoreRepos", "ignoreAuthors", "ignorePaths", "instructions", "autoStartWatcher", "maxDiffChars",
    "maxParts", "cheapEffort", "smallMaxLines", "smallMaxFiles", "riskyPaths", "docsPaths", "agent.timeoutSeconds", "smartModel", "splitLarge"]) {
    assert.ok(keys.has(k), k);
  }
});

test("a setting inside a group (agent.timeoutSeconds) is saved there, and removed with the group when back at the default", () => {
  const raw = {};
  S.setValue(raw, "agent.timeoutSeconds", 300);
  assert.deepEqual(raw, { agent: { timeoutSeconds: 300 } });
  assert.equal(S.effective(raw, "agent.timeoutSeconds"), 300);
  S.setValue(raw, "agent.timeoutSeconds", 900);
  assert.deepEqual(raw, {}, "back at the default: the key and the empty group are gone");
  const keep = { agent: { command: ["claude"], timeoutSeconds: 300 } };
  S.setValue(keep, "agent.timeoutSeconds", 900);
  assert.deepEqual(keep, { agent: { command: ["claude"] } }, "other keys in the group stay");
  assert.deepEqual(S.setValue({}, "agent.timeoutSeconds", 900), {}, "setting the default on an empty file adds nothing");
});

test("a timeout saved from the panel reaches the reviewer", () => {
  const raw = S.readRaw();
  S.setValue(raw, "agent.timeoutSeconds", 120);
  S.writeRaw(raw);
  assert.equal(loadConfig().agent.timeoutSeconds, 120);
  assert.ok(loadConfig().agent.command.includes("--restricted"), "the lockdown flags are still there");
  const back = S.readRaw();
  S.setValue(back, "agent.timeoutSeconds", 900);
  S.writeRaw(back);
});

test("lists are typed as comma separated text: trimmed, no empties, no repeats", () => {
  const f = S.FIELDS.find((x) => x.key === "ignoreAuthors");
  assert.deepEqual(S.parseList(f, " dependabot[bot] , ,renovate[bot],dependabot[bot] "), ["dependabot[bot]", "renovate[bot]"]);
  assert.deepEqual(S.parseList(f, ""), []);
  assert.equal(S.listText(["a", "b"]), "a, b");
  assert.equal(S.listText(undefined), "");
});

test("never-review repos must be owner/repo (a pasted GitHub link is fine)", () => {
  const f = S.FIELDS.find((x) => x.key === "ignoreRepos");
  assert.deepEqual(S.parseList(f, "BigGeo-GIV/bg-asterisk, https://github.com/a/b.git"), ["BigGeo-GIV/bg-asterisk", "a/b"]);
  assert.throws(() => S.parseList(f, "not a repo"), /owner\/repo/);
});

test("ignoreRepos and onlyListedRepos set from the panel are saved and load back", () => {
  const raw = S.readRaw();
  S.setValue(raw, "ignoreRepos", ["work/big-repo"]);
  S.setValue(raw, "onlyListedRepos", false);
  S.writeRaw(raw);
  const cfg = loadConfig();
  assert.deepEqual(cfg.ignoreRepos, ["work/big-repo"]);
  assert.equal(cfg.onlyListedRepos, false);
  const back = S.readRaw();
  S.setValue(back, "ignoreRepos", []);
  S.setValue(back, "onlyListedRepos", true);
  S.writeRaw(back);
});

test("the example config new installs start from doesn't pin onlyListedRepos, so the safe default applies", () => {
  const example = JSON.parse(fs.readFileSync(new URL("../config.example.json", import.meta.url), "utf8"));
  assert.equal("onlyListedRepos" in example, false);
});
