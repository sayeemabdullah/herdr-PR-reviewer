// Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-home-"));
process.env.HOME = home;
process.env.HERDR_PLUGIN_CONFIG_DIR = path.join(home, "cfg");
process.env.HERDR_PLUGIN_STATE_DIR = path.join(home, "state");
const { LAUNCHER, installCli, writeLauncher } = await import("../src/lib.js");
const bin = path.join(home, ".local", "bin");

test("the launcher opens PR Panel", () => {
  writeLauncher();
  assert.match(fs.readFileSync(LAUNCHER, "utf8"), /src\/panel\.js/);
});

test("at startup nothing is installed unless the old pr-inbox command is", () => {
  assert.deepEqual(installCli({ onlyIfOld: true }), { ok: true, message: "" });
  assert.ok(!fs.existsSync(path.join(bin, "pr-panel")));
});

test("an old pr-inbox link of ours is swapped for pr-panel", () => {
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(path.join(path.dirname(LAUNCHER), "pr-inbox"), path.join(bin, "pr-inbox"));
  const r = installCli({ onlyIfOld: true });
  assert.ok(r.ok);
  assert.match(r.message, /now called pr-panel/);
  assert.equal(fs.readlinkSync(path.join(bin, "pr-panel")), LAUNCHER);
  assert.ok(!fs.existsSync(path.join(bin, "pr-inbox")) && !isLink(path.join(bin, "pr-inbox")));
});

test("a pr-inbox that isn't ours is left alone", () => {
  fs.writeFileSync(path.join(bin, "pr-inbox"), "#!/bin/sh\necho mine\n");
  installCli();
  assert.equal(fs.readFileSync(path.join(bin, "pr-inbox"), "utf8"), "#!/bin/sh\necho mine\n");
});

function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}
