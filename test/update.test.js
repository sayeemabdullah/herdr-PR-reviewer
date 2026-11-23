// Updating from GitHub releases, against a stub `herdr` and `gh`: nothing real is installed. Run with: node --test
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-update-")));
const bin = path.join(tmp, "bin");
const LOG = path.join(tmp, "herdr.log");
const FAKE_ROOT = path.join(tmp, "plugin-root");
fs.mkdirSync(bin);
fs.mkdirSync(FAKE_ROOT);
process.env.HERDR_PLUGIN_CONFIG_DIR = path.join(tmp, "cfg");
process.env.HERDR_PLUGIN_STATE_DIR = path.join(tmp, "state");
process.env.HERDR_BIN_PATH = path.join(bin, "herdr");
const script = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env node\n${body}`); fs.chmodSync(path.join(bin, name), 0o755); };

// Stub herdr: `plugin list` says where the plugin came from; `plugin install` rewrites the plugin folder's version.
script("herdr", `
const fs = require("fs"), a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify(a) + "\\n");
if (a[0] === "plugin" && a[1] === "list") {
  const src = process.env.SRC || "github:sayeemabdullah/herdr-PR-reviewer@v0.5.0";
  console.log("1 plugin installed:\\n- pr-reviewer (PR Reviewer) enabled [" + src + "]\\n  config: /x");
} else if (a[0] === "plugin" && a[1] === "install") {
  const write = (v) => fs.writeFileSync(process.env.FAKE_ROOT + "/herdr-plugin.toml", 'version = "' + v + '"\\n');
  const ref = a[a.indexOf("--ref") + 1].slice(1);
  if (process.env.WRITE_THEN_FAIL) { write(process.env.WRITE_THEN_FAIL); process.stderr.write("noise\\nbuild step failed\\n"); process.exit(1); }
  if (process.env.FAIL) { process.stderr.write("noise\\nclone failed: network is down\\n"); process.exit(1); }
  write(process.env.WRITE_VERSION || ref);
  console.log("Installed pr-reviewer");
}
`);
// Stub gh: the release list comes from RELEASES, or the call fails.
script("gh", `
if (process.env.GH_FAIL) { process.stderr.write("HTTP 502\\n"); process.exit(1); }
process.stdout.write(process.env.RELEASES || "[]");
`);
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_ROOT = FAKE_ROOT;

const U = await import("../src/update.js");
const lib = await import("../src/lib.js");
const setVersion = (v) => fs.writeFileSync(path.join(FAKE_ROOT, "herdr-plugin.toml"), `id = "pr-reviewer"\nversion = "${v}"\n`);
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const installs = () => calls().filter((c) => c[1] === "install");
const reset = () => {
  fs.rmSync(LOG, { force: true });
  for (const f of ["update.json", "update.lock", "restart-requested", "watcher.json"]) fs.rmSync(path.join(process.env.HERDR_PLUGIN_STATE_DIR, f), { force: true });
  for (const k of ["SRC", "FAIL", "WRITE_VERSION", "WRITE_THEN_FAIL", "RELEASES", "GH_FAIL"]) delete process.env[k];
  setVersion("0.5.0");
};
const rel = (tag, extra = {}) => ({ tag_name: tag, name: tag, body: `notes for ${tag}`, html_url: `https://example.test/${tag}`, published_at: "2026-11-22T00:00:00Z", draft: false, prerelease: false, ...extra });

test("versions compare by number, not by text", () => {
  assert.equal(U.compareVersions("0.10.0", "0.9.0"), 1);
  assert.equal(U.compareVersions("v1.0.0", "0.99.99"), 1);
  assert.equal(U.compareVersions("0.5.0", "v0.5.0"), 0);
  assert.equal(U.compareVersions("0.4.9", "0.5.0"), -1);
  assert.deepEqual(U.parseVersion("v1.2.3"), [1, 2, 3]);
  for (const bad of ["1.2", "1.2.3-beta", "latest", "", null, "v1.2.3; rm -rf /"]) assert.equal(U.parseVersion(bad), null, String(bad));
  assert.throws(() => U.compareVersions("1.2", "1.2.3"), /can't compare/);
});

test("only published, plain, newer releases count, newest first", () => {
  const got = U.pickUpdates([
    rel("v0.6.0"), rel("v0.10.0"), rel("v0.7.0", { draft: true }), rel("v0.8.0", { prerelease: true }), rel("v0.5.0"), rel("v0.4.0"),
    rel("nightly"), rel("v1.0.0-rc1"), rel("v0.9.0"), null,
  ], "0.5.0");
  assert.deepEqual(got.map((r) => r.version), ["0.10.0", "0.9.0", "0.6.0"]);
  assert.deepEqual(got[0], { tag: "v0.10.0", version: "0.10.0", name: "v0.10.0", body: "notes for v0.10.0", url: "https://example.test/v0.10.0", publishedAt: "2026-11-22T00:00:00Z" });
  assert.deepEqual(U.pickUpdates("nonsense", "0.5.0"), []);
  assert.deepEqual(U.pickUpdates([rel("v0.6.0")], "garbage"), []);
});

test("the installed version is read from the plugin folder", () => {
  reset();
  setVersion("0.5.0");
  assert.equal(U.installedVersion(FAKE_ROOT), "0.5.0");
  assert.equal(U.installedVersion(path.join(tmp, "nowhere")), null);
});

test("a check asks GitHub at most once per interval, unless forced, and a new installed version invalidates it", () => {
  reset();
  let asked = 0;
  const fetch = () => { asked++; return [rel("v0.6.0")]; };
  const a = U.checkForUpdate({ root: FAKE_ROOT, fetch, now: 1_000_000 });
  assert.equal(a.latest, "0.6.0");
  assert.equal(a.releases.length, 1);
  U.checkForUpdate({ root: FAKE_ROOT, fetch, now: 1_000_000 + 3600_000 });
  assert.equal(asked, 1, "within 6 hours: from the remembered answer");
  U.checkForUpdate({ root: FAKE_ROOT, fetch, now: 1_000_000 + 7 * 3600_000 });
  assert.equal(asked, 2, "after 6 hours: asks again");
  U.checkForUpdate({ root: FAKE_ROOT, fetch, now: 1_000_000 + 7 * 3600_000 + 1, force: true });
  assert.equal(asked, 3, "forced");
  setVersion("0.6.0");
  const after = U.checkForUpdate({ root: FAKE_ROOT, fetch: () => { asked++; return [rel("v0.6.0")]; }, now: 1_000_000 + 7 * 3600_000 + 2 });
  assert.equal(asked, 4, "the installed version changed: ask again");
  assert.deepEqual(after.releases, [], "0.6.0 is no longer newer");
  assert.equal(after.latest, null);
});

test("a failed check is remembered, never thrown, and retried after 30 minutes", () => {
  reset();
  let asked = 0;
  const failing = () => { asked++; throw new Error("HTTP 502\nmore"); };
  const st = U.checkForUpdate({ root: FAKE_ROOT, fetch: failing, now: 5_000_000 });
  assert.equal(st.error, "HTTP 502");
  U.checkForUpdate({ root: FAKE_ROOT, fetch: failing, now: 5_000_000 + 10 * 60_000 });
  assert.equal(asked, 1, "10 minutes later: not again");
  U.checkForUpdate({ root: FAKE_ROOT, fetch: () => { asked++; return [rel("v0.6.0")]; }, now: 5_000_000 + 31 * 60_000 });
  assert.equal(asked, 2);
  assert.equal(U.readUpdateState().error, null, "a good answer clears the error");
});

test("the default check reads GitHub's release list through gh, and says so when gh fails", () => {
  reset();
  process.env.RELEASES = JSON.stringify([rel("v0.7.0"), rel("v0.6.0")]);
  const ok = U.checkForUpdate({ root: FAKE_ROOT, force: true });
  assert.deepEqual(ok.releases.map((r) => r.version), ["0.7.0", "0.6.0"]);
  process.env.GH_FAIL = "1";
  const bad = U.checkForUpdate({ root: FAKE_ROOT, force: true });
  assert.equal(bad.error, "HTTP 502");
  process.env.GH_FAIL = "";
  process.env.RELEASES = "not json";
  delete process.env.GH_FAIL;
  assert.match(U.checkForUpdate({ root: FAKE_ROOT, force: true }).error, /wasn't readable/);
});

test("only a GitHub install of this repo can be updated; a linked folder can't", () => {
  reset();
  assert.deepEqual(U.installSource(), { kind: "github", repo: "sayeemabdullah/herdr-PR-reviewer", ref: "v0.5.0", source: "github:sayeemabdullah/herdr-PR-reviewer@v0.5.0", canUpdate: true });
  process.env.SRC = "github:someone-else/fork@main";
  assert.equal(U.installSource().canUpdate, false);
  assert.match(U.cannotUpdateReason(U.installSource()), /someone-else\/fork/);
  process.env.SRC = "link:/Users/me/herdr-PR-reviewer";
  assert.equal(U.installSource().kind, "other");
  assert.match(U.cannotUpdateReason(U.installSource()), /local folder/);
  reset();
});

test("update: installs the exact release from this repo with herdr, checks the result, and asks the watcher to restart", () => {
  reset();
  const r = U.applyUpdate("v0.6.0", { root: FAKE_ROOT });
  assert.deepEqual(r, { from: "0.5.0", to: "0.6.0" });
  assert.deepEqual(installs(), [["plugin", "install", "sayeemabdullah/herdr-PR-reviewer", "--ref", "v0.6.0", "-y"]]);
  assert.equal(U.installedVersion(FAKE_ROOT), "0.6.0");
  assert.equal(U.restartRequested(), true);
  const st = U.readUpdateState();
  assert.equal(st.lastUpdate.from, "0.5.0");
  assert.equal(st.lastUpdate.to, "0.6.0");
  assert.deepEqual(st.releases, []);
  assert.equal(fs.existsSync(path.join(process.env.HERDR_PLUGIN_STATE_DIR, "update.lock")), false, "the lock is released");
});

test("update refuses anything that isn't a newer plain release tag, without running herdr", () => {
  reset();
  for (const bad of ["master", "main", "v0.6", "0.6.0", "v0.6.0; rm -rf ~", "v0.6.0 --ref x", "../v0.6.0", "", undefined]) {
    assert.throws(() => U.applyUpdate(bad, { root: FAKE_ROOT }), /isn't a release version/, String(bad));
  }
  assert.throws(() => U.applyUpdate("v0.5.0", { root: FAKE_ROOT }), /isn't newer/);
  assert.throws(() => U.applyUpdate("v0.4.0", { root: FAKE_ROOT }), /isn't newer/, "no downgrades");
  assert.equal(installs().length, 0);
});

test("update refuses a linked or foreign install, and an update that is already running", () => {
  reset();
  process.env.SRC = "link:/Users/me/herdr-PR-reviewer";
  assert.throws(() => U.applyUpdate("v0.6.0", { root: FAKE_ROOT }), /local folder/);
  delete process.env.SRC;
  fs.mkdirSync(process.env.HERDR_PLUGIN_STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.HERDR_PLUGIN_STATE_DIR, "update.lock"), JSON.stringify({ pid: process.pid }));
  assert.throws(() => U.applyUpdate("v0.6.0", { root: FAKE_ROOT }), /already running/);
  assert.equal(installs().length, 0);
  fs.rmSync(path.join(process.env.HERDR_PLUGIN_STATE_DIR, "update.lock"));
});

test("a lock left by a process that is gone doesn't block an update", () => {
  reset();
  fs.mkdirSync(process.env.HERDR_PLUGIN_STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.HERDR_PLUGIN_STATE_DIR, "update.lock"), JSON.stringify({ pid: 2_000_000_000 }));
  assert.equal(U.applyUpdate("v0.6.0", { root: FAKE_ROOT }).to, "0.6.0");
});

test("a failed install says why, changes nothing, and doesn't ask for a restart", () => {
  reset();
  process.env.FAIL = "1";
  assert.throws(() => U.applyUpdate("v0.6.0", { root: FAKE_ROOT }), /couldn't install v0\.6\.0: clone failed: network is down/);
  assert.equal(U.installedVersion(FAKE_ROOT), "0.5.0");
  assert.equal(installs().length, 1, "nothing to roll back, so no second install");
  assert.equal(U.restartRequested(), false);
  assert.equal(fs.existsSync(path.join(process.env.HERDR_PLUGIN_STATE_DIR, "update.lock")), false);
});

test("an install that leaves the wrong version behind is rolled back to the old release", () => {
  reset();
  process.env.WRITE_VERSION = "0.5.9";
  assert.throws(() => U.applyUpdate("v0.6.0", { root: FAKE_ROOT }), /still says 0\.5\.9/);
  assert.deepEqual(installs().map((c) => c[c.indexOf("--ref") + 1]), ["v0.6.0", "v0.5.0"], "tried the old release again");
  assert.equal(U.restartRequested(), false);
});

test("an install that fails half way, leaving something else behind, is rolled back too", () => {
  reset();
  process.env.WRITE_THEN_FAIL = "0.5.9";
  assert.throws(() => U.applyUpdate("v0.6.0", { root: FAKE_ROOT }), /build step failed/);
  assert.equal(installs().length, 2);
});

test("a successful update clears an earlier failure, so the panel stops showing it", () => {
  reset();
  fs.mkdirSync(process.env.HERDR_PLUGIN_STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.HERDR_PLUGIN_STATE_DIR, "update.json"), JSON.stringify({ failedTag: "v0.6.0", updateError: "clone failed" }));
  U.applyUpdate("v0.6.0", { root: FAKE_ROOT });
  const st = U.readUpdateState();
  assert.equal(st.updateError, null);
  assert.equal(st.failedTag, null);
});

test("a rollback that works says nothing extra; one that fails tells you how to get the old version back", () => {
  reset();
  const wrongThenRestore = (tag) => { setVersion(tag === "v0.6.0" ? "0.5.9" : tag.slice(1)); return { ok: true, stdout: "", stderr: "" }; };
  assert.throws(() => U.applyUpdate("v0.6.0", { root: FAKE_ROOT, install: wrongThenRestore }), (e) => /still says 0\.5\.9/.test(e.message) && !/couldn't put/.test(e.message));
  assert.equal(U.installedVersion(FAKE_ROOT), "0.5.0");
  reset();
  const neverRestores = (tag) => { setVersion("0.5.9"); return { ok: tag === "v0.6.0", stdout: "", stderr: "boom" }; };
  assert.throws(() => U.applyUpdate("v0.6.0", { root: FAKE_ROOT, install: neverRestores }), /couldn't put 0\.5\.0 back: run herdr plugin install sayeemabdullah\/herdr-PR-reviewer --ref v0\.5\.0/);
});

test("restarting the watcher starts a fresh one, detached, and clears the markers", () => {
  reset();
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "restart-requested"), "{}");
  fs.writeFileSync(lib.WATCHER_FILE, JSON.stringify({ pid: process.pid }));
  let seen;
  U.restartWatcher({ spawnFn: (cmd, args, opts) => { seen = { cmd, args, opts }; return { unref() { seen.unref = true; } }; } });
  assert.equal(U.restartRequested(), false);
  assert.equal(fs.existsSync(lib.WATCHER_FILE), false, "the old watcher's pid file is gone, so the new one isn't taken for it");
  assert.equal(seen.cmd, process.execPath);
  assert.deepEqual(seen.args.slice(-2), ["watcher", "--no-focus"]);
  assert.match(seen.args[0], /open-pane\.js$/);
  assert.equal(seen.opts.detached, true);
  assert.equal(seen.unref, true);
});

const cfg = (over = {}) => ({ checkForUpdates: true, autoUpdate: false, desktopNotifications: false, ...over });
const stateWith = (releases, over = {}) => ({ releases, ...over });

test("auto step: off, current, and told-once when an update exists but auto is off", () => {
  reset();
  assert.equal(U.autoUpdateStep(cfg({ checkForUpdates: false })), "off");
  assert.equal(U.autoUpdateStep(cfg(), { check: () => stateWith([]) }), "current");
  const told = [];
  const deps = { check: () => stateWith([{ tag: "v0.6.0", version: "0.6.0" }], U.readUpdateState()), tell: (...a) => told.push(a), apply: () => assert.fail("must not install"), active: () => [] };
  assert.equal(U.autoUpdateStep(cfg(), deps), "notified");
  assert.equal(told.length, 1);
  assert.match(told[0][1], /0\.6\.0 is available/);
  assert.equal(U.autoUpdateStep(cfg(), { ...deps, check: () => stateWith([{ tag: "v0.6.0", version: "0.6.0" }], U.readUpdateState()) }), "available", "the same version isn't announced twice");
  assert.equal(told.length, 1);
});

test("auto step with autoUpdate on: waits for running reviews, then installs the newest release", () => {
  reset();
  const check = () => stateWith([{ tag: "v0.6.0", version: "0.6.0" }, { tag: "v0.5.5", version: "0.5.5" }]);
  const applied = [];
  const base = { check, apply: (t) => applied.push(t), tell: () => {}, source: () => ({ canUpdate: true }) };
  assert.equal(U.autoUpdateStep(cfg({ autoUpdate: true }), { ...base, active: () => ["o/r#1"] }), "waiting");
  assert.deepEqual(applied, []);
  assert.equal(U.autoUpdateStep(cfg({ autoUpdate: true }), { ...base, active: () => [] }), "updated");
  assert.deepEqual(applied, ["v0.6.0"]);
});

test("auto step: a linked install is left alone, and a failed update isn't retried over and over", () => {
  reset();
  const check = () => stateWith([{ tag: "v0.6.0", version: "0.6.0" }], U.readUpdateState());
  assert.equal(U.autoUpdateStep(cfg({ autoUpdate: true }), { check, active: () => [], source: () => ({ canUpdate: false }), apply: () => assert.fail("no") }), "cannot");
  let tries = 0;
  const failing = { check, active: () => [], source: () => ({ canUpdate: true }), apply: () => { tries++; throw new Error("network is down\nmore"); } };
  assert.equal(U.autoUpdateStep(cfg({ autoUpdate: true }), failing), "failed: network is down");
  assert.match(U.autoUpdateStep(cfg({ autoUpdate: true }), failing), /^failed: waiting/);
  assert.equal(tries, 1);
  assert.equal(U.readUpdateState().updateError, "network is down");
});

test("auto step never throws, even when everything under it does", () => {
  reset();
  assert.match(U.autoUpdateStep(cfg(), { check: () => { throw new Error("boom"); } }), /^failed: boom/);
});

test("command line: says when you're up to date, when something newer exists, and installs with --install", () => {
  reset();
  const env = { ...process.env, HERDR_PLUGIN_ROOT: FAKE_ROOT, RELEASES: JSON.stringify([rel("v0.5.0")]) };
  const run = (args, e = env) => spawnSync(process.execPath, [new URL("../src/update.js", import.meta.url).pathname, ...args], { env: e, encoding: "utf8" });
  const same = run([]);
  assert.equal(same.status, 0);
  assert.match(same.stdout, /PR Reviewer 0\.5\.0/);
  assert.match(same.stdout, /up to date/);
  const newer = { ...env, RELEASES: JSON.stringify([rel("v0.6.0")]) };
  const found = run([], newer);
  assert.match(found.stdout, /↑ 0\.6\.0 is available/);
  assert.match(found.stdout, /pr-panel update --install/);
  assert.equal(installs().length, 0, "checking installs nothing");
  const did = run(["--install"], newer);
  assert.equal(did.status, 0, did.stderr);
  assert.match(did.stdout, /updated 0\.5\.0 → 0\.6\.0/);
  assert.equal(installs().length, 1);
  reset();
  const offline = run([], { ...env, GH_FAIL: "1" });
  assert.equal(offline.status, 1);
  assert.match(offline.stderr, /couldn't check for updates: HTTP 502/);
});

test("the pr-panel launcher and the bin script both route `update` to update.js", () => {
  const binScript = fs.readFileSync(new URL("../bin/pr-panel", import.meta.url), "utf8");
  assert.match(binScript, /"\$1" = "update".*src\/update\.js/);
  const libSrc = fs.readFileSync(new URL("../src/lib.js", import.meta.url), "utf8");
  assert.match(libSrc, /"\$1" = "update".*src\/update\.js/);
});

test("the settings for it are in the panel, on and off by default as promised", async () => {
  const S = await import("../src/settings.js");
  assert.equal(S.effective({}, "checkForUpdates"), true);
  assert.equal(S.effective({}, "autoUpdate"), false, "installing code by itself is opt-in");
  assert.ok(S.FIELDS.some((f) => f.key === "autoUpdate" && f.type === "bool"));
  assert.ok(S.FIELDS.some((f) => f.key === "checkForUpdates" && f.type === "bool"));
});

test("a running watcher that finds the 'updated' marker exits and starts a fresh watcher on the new code", async () => {
  reset();
  const state = path.join(tmp, "state-watcher");
  fs.rmSync(state, { recursive: true, force: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, "restart-requested"), JSON.stringify({ version: "v0.6.0" }));
  const r = spawnSync(process.execPath, [new URL("../src/watcher.js", import.meta.url).pathname], {
    env: { ...process.env, HERDR_PLUGIN_STATE_DIR: state, HERDR_PLUGIN_CONFIG_DIR: path.join(tmp, "cfg-watcher") },
    encoding: "utf8", timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /restarting the watcher on the new version/);
  assert.equal(fs.existsSync(path.join(state, "restart-requested")), false, "the marker is cleared");
  assert.equal(fs.existsSync(path.join(state, "watcher.json")), false, "no stale pid file for the new watcher to trip over");
  // The fresh watcher is started by open-pane.js, which asks herdr to open the watcher pane.
  let opened = [];
  for (let i = 0; i < 50 && !opened.length; i++) {
    opened = calls().filter((c) => c[0] === "plugin" && c[1] === "pane" && c[2] === "open");
    if (!opened.length) await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(opened.length, 1, "herdr was asked to open the watcher pane");
  assert.ok(opened[0].includes("watcher") && opened[0].includes("--no-focus"));
});
