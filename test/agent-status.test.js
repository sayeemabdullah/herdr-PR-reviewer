// Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-test-"));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
const { statusFor } = await import("../src/agent-status.js");

const d = (repo, number) => ({ repo, number });

test("nothing to do → idle, inbox empty", () => {
  assert.deepEqual(statusFor({}), { state: "idle", title: "inbox empty", message: "No reviews waiting" });
});

test("reviews waiting → blocked (herdr's 'needs you'), with the count and which PRs", () => {
  const s = statusFor({ drafts: [d("acme/api", 212), d("acme/web", 415)] });
  assert.equal(s.state, "blocked");
  assert.equal(s.title, "2 waiting");
  assert.match(s.message, /2 reviews waiting.*acme\/api#212, acme\/web#415/);
  assert.match(statusFor({ drafts: [d("a/b", 1)] }).message, /^1 review waiting/);
});

test("a review running → working, and still shows how many are waiting", () => {
  const s = statusFor({ drafts: [d("acme/api", 212)], active: ["acme/web#418"] });
  assert.equal(s.state, "working");
  assert.equal(s.title, "reviewing web#418 · 1 waiting");
  assert.equal(statusFor({ active: ["acme/web#418"] }).title, "reviewing web#418");
});
