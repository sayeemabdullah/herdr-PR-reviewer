// Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-test-"));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
process.env.HERDR_PLUGIN_STATE_DIR = path.join(tmp, "state");
const A = await import("../src/agents.js");
const { DEFAULTS, loadConfig, settingsFor, CONFIG_FILE } = await import("../src/lib.js");
const S = await import("../src/settings.js");

/** A folder on PATH holding empty executables with these names. */
function fakeBin(...names) {
  const dir = fs.mkdtempSync(path.join(tmp, "bin-"));
  for (const n of names) { fs.writeFileSync(path.join(dir, n), "#!/bin/sh\n"); fs.chmodSync(path.join(dir, n), 0o755); }
  return dir;
}
const settings = (over = {}) => ({ ...DEFAULTS, agentIsCustom: false, ...over });

test("auto picks the first installed AI, most locked down first", () => {
  const dir = fakeBin("opencode", "codex", "gemini");
  assert.deepEqual(A.detectAgents(dir).map((a) => a.id), ["codex", "gemini", "opencode"]);
  assert.equal(A.pickAgent(settings(), dir).adapter.id, "codex");
  assert.equal(A.pickAgent(settings({ ai: "gemini" }), dir).adapter.id, "gemini");
  assert.equal(A.pickAgent(settings(), fakeBin("claude", "codex")).adapter.id, "claude");
});

test("a relative PATH entry still gives an absolute path to the AI", () => {
  const dir = fakeBin("codex");
  const found = A.findOnPath(["codex"], path.relative(process.cwd(), dir));
  assert.equal(found, path.join(dir, "codex"));
  assert.ok(path.isAbsolute(found));
});

test("Cursor is found as cursor-agent or agent", () => {
  assert.equal(A.pickAgent(settings(), fakeBin("agent")).adapter.id, "cursor");
  assert.match(A.pickAgent(settings(), fakeBin("cursor-agent")).bin, /cursor-agent$/);
});

test("no AI installed, or the chosen one missing, gives a readable error", () => {
  const empty = fakeBin();
  assert.throws(() => A.pickAgent(settings(), empty), /No AI CLI found/);
  assert.throws(() => A.pickAgent(settings({ ai: "codex" }), empty), /Codex isn't installed/);
  assert.throws(() => A.pickAgent(settings({ ai: "nope" }), empty), /unknown AI "nope"/);
});

test("a hand-written agent.command keeps working with auto, and an explicit AI wins over it", () => {
  const dir = fakeBin("codex");
  assert.equal(A.pickAgent(settings({ agentIsCustom: true }), empty()).adapter.id, "custom");
  assert.equal(A.pickAgent(settings({ agentIsCustom: true, ai: "codex" }), dir).adapter.id, "codex");
  function empty() { return fakeBin(); }
});

test("config: agentIsCustom comes from the file, and a bad ai is refused", () => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ repos: [] }));
  assert.equal(loadConfig().agentIsCustom, false);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ agent: { command: ["my-ai"] } }));
  assert.equal(loadConfig().agentIsCustom, true);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ai: "gpt" }));
  assert.throws(() => loadConfig(), /"ai" must be/);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ repos: [{ repo: "a/b", ai: "bard" }] }));
  assert.throws(() => loadConfig(), /a\/b: "ai" must be/);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ai: "auto", repos: [{ repo: "a/b", ai: "codex" }] }));
  assert.equal(settingsFor(loadConfig(), "a/b").ai, "codex", "per-repo ai overrides");
  fs.rmSync(CONFIG_FILE);
});

const ctx = (o = {}) => ({ bin: "/x/bin", settings: settings(), codeAccess: true, workDir: "/work", tmp: "/tmp/run", prompt: "PROMPT", ...o });

test("Claude's command is unchanged: restricted flags plus model and effort", () => {
  const p = A.planRun(A.getAgent("claude"), ctx());
  assert.deepEqual(p.argv.slice(0, 4), ["claude", "-p", "--restricted", "--strict-mcp-config"]);
  assert.ok(p.argv.includes("--safe-mode") && p.argv.includes("Read,Grep,Glob"));
  assert.deepEqual(p.argv.slice(-4), ["--model", "opus", "--effort", "high"]);
  assert.equal(p.input, "PROMPT");
  assert.ok(!A.planRun(A.getAgent("claude"), ctx({ codeAccess: false })).argv.includes("Read,Grep,Glob"), "diff-only has no tools");
});

test("Codex: own config, rules and sessions off, read-only sandbox, prompt on stdin, reply from a file", () => {
  const p = A.planRun(A.getAgent("codex"), ctx());
  assert.deepEqual(p.argv.slice(0, 2), ["/x/bin", "exec"]);
  for (const f of ["--ignore-user-config", "--ignore-rules", "--ephemeral"]) assert.ok(p.argv.includes(f), f);
  assert.deepEqual(p.argv.slice(p.argv.indexOf("--sandbox"), p.argv.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
  assert.deepEqual(p.argv.slice(p.argv.indexOf("-C"), p.argv.indexOf("-C") + 2), ["-C", "/work"]);
  assert.equal(p.argv.at(-1), "-");
  assert.ok(!p.argv.includes("-m"), "Claude's \"opus\" is not passed to Codex");
  assert.equal(p.argv[p.argv.indexOf("-c") + 1], 'model_reasoning_effort="high"');
  assert.equal(p.input, "PROMPT");
  assert.equal(p.outFile, "/tmp/run/last-message.txt");
});

test("a model typed or picked for a non-Claude AI is passed on", () => {
  const argv = (id, model) => A.planRun(A.getAgent(id), ctx({ settings: settings({ model }) })).argv;
  assert.deepEqual(argv("codex", "gpt-5.5").slice(argv("codex", "gpt-5.5").indexOf("-m"), -3).slice(0, 2), ["-m", "gpt-5.5"]);
  assert.ok(argv("gemini", "gemini-2.5-pro").join(" ").includes("-m gemini-2.5-pro"));
  assert.ok(argv("cursor", "sonnet-4").join(" ").includes("--model sonnet-4"));
  assert.ok(argv("opencode", "anthropic/claude-x").join(" ").includes("-m anthropic/claude-x"));
  for (const id of ["codex", "gemini", "cursor", "opencode"]) assert.ok(!argv(id, "default").join(" ").match(/ -m | --model /), id);
});

test("Gemini: plan mode, no extensions or MCP servers, no effort flag", () => {
  const a = A.planRun(A.getAgent("gemini"), ctx()).argv.join(" ");
  assert.match(a, /--approval-mode plan/);
  assert.match(a, /--extensions none/);
  assert.match(a, /--allowed-mcp-server-names none/);
  assert.doesNotMatch(a, /effort/);
});

test("Cursor and opencode take the prompt as a file in the working folder, with a deny list for tools", () => {
  const c = A.planRun(A.getAgent("cursor"), ctx());
  assert.match(c.argv.join(" "), /-p --mode ask --sandbox enabled --trust/);
  assert.equal(c.workFiles[A.PROMPT_FILE], "PROMPT");
  const perms = JSON.parse(c.workFiles[".cursor/cli.json"]).permissions;
  for (const d of ["Shell(*)", "Write(**)", "WebFetch(*)", "Mcp(*:*)"]) assert.ok(perms.deny.includes(d), d);
  assert.ok(c.argv.at(-1).includes(A.PROMPT_FILE) && c.input === "");

  const o = A.planRun(A.getAgent("opencode"), ctx());
  assert.match(o.argv.join(" "), /run --pure --dir \/work/);
  assert.equal(o.workFiles[A.PROMPT_FILE], "PROMPT");
  const perm = JSON.parse(o.env.OPENCODE_CONFIG_CONTENT).permission;
  assert.deepEqual([perm.bash, perm.edit, perm.webfetch, perm.external_directory], ["deny", "deny", "deny", "deny"]);
});

test("only Claude counts as fully locked down", () => {
  assert.deepEqual(A.AI_IDS.map((id) => [id, A.getAgent(id).lockdown]),
    [["claude", "full"], ["codex", "partial"], ["gemini", "partial"], ["cursor", "partial"], ["opencode", "partial"]]);
});

test("hardenCheckout removes symlinks and instruction/settings files, at any depth and in any case", () => {
  const d = fs.mkdtempSync(path.join(tmp, "co-"));
  fs.mkdirSync(path.join(d, "src/deep"), { recursive: true });
  fs.mkdirSync(path.join(d, ".cursor"));
  fs.mkdirSync(path.join(d, "pkg/.Gemini"), { recursive: true });
  fs.writeFileSync(path.join(d, ".git"), "gitdir: /elsewhere");
  for (const f of ["src/app.js", "README.md", "AGENTS.md", "src/deep/agents.md", "CLAUDE.md", "GEMINI.md", "opencode.json",
    ".cursor/cli.json", "pkg/.Gemini/settings.json", "pkg/keep.txt"]) fs.writeFileSync(path.join(d, f), "x");
  fs.symlinkSync("/etc/hosts", path.join(d, "notes.md"));
  fs.symlinkSync("..", path.join(d, "src/up"));
  const removed = A.hardenCheckout(d).sort();
  assert.deepEqual(removed, [".cursor/", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "notes.md", "opencode.json", "pkg/.Gemini/",
    "src/deep/agents.md", "src/up"]);
  const left = [];
  (function walk(p) { for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? walk(path.join(p, e.name)) : left.push(path.relative(d, path.join(p, e.name))); })(d);
  assert.deepEqual(left.sort(), [".git", "README.md", "pkg/keep.txt", "src/app.js"]);
});

test("settings: the AI list only has installed ones, and each AI has its own models and efforts", () => {
  const raw = {};
  assert.equal(S.aiOptions(raw)[0], "auto");
  assert.ok(S.aiOptions({ ai: "codex" }).includes("codex"), "a chosen AI stays listed even if it went missing");
  assert.deepEqual(S.modelOptions({ ai: "claude" }), ["opus", "fable", "sonnet", "haiku"]);
  assert.equal(S.modelOptions({ ai: "codex" })[0], "default");
  assert.deepEqual(S.effortOptions({ ai: "gemini" }), []);
  assert.ok(S.effortOptions({ ai: "codex" }).includes("high"));
  assert.ok(S.modelOptions({ ai: "claude", repos: [{ repo: "a/b", ai: "codex" }] }, "a/b").includes("gpt-5.5"), "per repo");
});

test("settings: choosing an AI resets its model, drops an effort it lacks and clears per-repo models", () => {
  const raw = { model: "sonnet", effort: "max", repos: [{ repo: "a/b", review: "all", model: "haiku" }] };
  S.setAI(raw, "gemini");
  assert.equal(raw.ai, "gemini");
  assert.equal(raw.model, "default");
  assert.equal(raw.effort, undefined, "Gemini has no effort");
  assert.deepEqual(raw.repos, [{ repo: "a/b", review: "all" }]);
  S.setAI(raw, "claude");
  assert.equal(raw.model, undefined, "Claude's default (opus) is the default, so it's not written");
  S.setAI(raw, "auto");
  assert.equal(raw.ai, undefined);
});

test("settings: what is shown for a locked setting is what really happens, not the saved value", () => {
  assert.equal(S.forcedValue({ ai: "codex" }, "finalWord", false), true);
  assert.equal(S.forcedValue({ ai: "codex" }, "allowApprove", true), false);
  assert.equal(S.forcedValue({ ai: "claude" }, "allowApprove", true), true, "Claude keeps your setting");
  assert.equal(S.forcedValue({ ai: "codex" }, "skipDrafts", false), false, "other settings are untouched");
});

test("settings: an AI that can't be locked down fixes final word and approving", () => {
  assert.match(S.lockedReason({ ai: "codex" }, "finalWord"), /Codex can read files outside the PR, so reviews always wait for you/);
  assert.match(S.lockedReason({ ai: "codex" }, "allowApprove"), /never approves/);
  assert.equal(S.lockedReason({ ai: "claude" }, "finalWord"), null);
  assert.equal(S.lockedReason({ ai: "codex" }, "model"), null);
  assert.equal(S.lockedReason({ agent: { command: ["x"] } }, "finalWord"), null, "custom commands aren't judged");
});
