// The AI CLIs a review can run on, one adapter each: how to find it, and how to run it with the tightest
// lockdown it offers. Nothing here imports lib.js, so lib.js can import this file.
//
// lockdown: "full"    = can't run commands or read outside the checkout (only Claude, via --restricted/--safe-mode)
//           "partial" = best effort. reviewPR then forces finalWord on and never approves.
//           "custom"  = a command the user wrote themselves in config.json (agent.command); we don't judge it.
import fs from "node:fs";
import path from "node:path";

export const PROMPT_FILE = ".pr-review-prompt.md";
const FILE_INSTRUCTION =
  `The complete task is in the file ${PROMPT_FILE} in your working directory. Read it and follow it exactly. ` +
  "Reply with ONLY the JSON object it asks for.";
const STDIN_INSTRUCTION = "Follow the instructions you were given on stdin. Reply with ONLY the JSON object they ask for.";

export const CLAUDE_MODELS = ["opus", "fable", "sonnet", "haiku"];
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/**
 * Add --model / --effort from settings to a Claude Code command, unless the command already sets them.
 * Other AI CLIs are left alone (they don't know these flags). Exported for tests.
 */
export function agentArgv(command, settings) {
  const argv = [...command];
  if (path.basename(argv[0] ?? "") !== "claude") return argv;
  if (settings.model && !argv.includes("--model")) argv.push("--model", settings.model);
  if (settings.effort && !argv.includes("--effort")) argv.push("--effort", settings.effort);
  return argv;
}

/** The model to pass to a non-Claude CLI, or null for "its own default" (also for Claude's aliases like "opus"). */
export const modelArg = (model) => (!model || model === "default" || CLAUDE_MODELS.includes(model) ? null : model);

const claude = {
  id: "claude", label: "Claude Code", bins: ["claude"], lockdown: "full",
  models: CLAUDE_MODELS, defaultModel: "opus", efforts: CLAUDE_EFFORTS,
  canReadCode: (s) => !!s.agent.codeCommand?.length,
  build: ({ settings, codeAccess, prompt }) => ({
    argv: agentArgv(codeAccess ? settings.agent.codeCommand : settings.agent.command, settings),
    input: prompt,
  }),
};

const AGENTS = {
  claude,

  // Codex: its own config, rules and sessions are off and the sandbox is read-only with no network. Its shell
  // can still read files outside the checkout, hence "partial".
  codex: {
    id: "codex", label: "Codex", bins: ["codex"], lockdown: "partial",
    models: ["default", "gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-sol", "gpt-5.6-sol", "gpt-5.5"], defaultModel: "default",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    canReadCode: () => true,
    build: ({ bin, model, effort, workDir, tmp, prompt }) => {
      const outFile = path.join(tmp, "last-message.txt");
      const argv = [bin, "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--sandbox", "read-only",
        "--skip-git-repo-check", "--color", "never", "-C", workDir, "-o", outFile];
      if (model) argv.push("-m", model);
      if (effort) argv.push("-c", `model_reasoning_effort="${effort}"`);
      argv.push("-");
      return { argv, input: prompt, outFile };
    },
    parse: (stdout, { outFile }) => {
      try { return fs.readFileSync(outFile, "utf8"); } catch { return stdout; }
    },
  },

  // Gemini: plan mode (read-only tools), no extensions, no MCP servers. Reads ~/.gemini settings, so "partial".
  gemini: {
    id: "gemini", label: "Gemini CLI", bins: ["gemini"], lockdown: "partial",
    models: ["default", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash"],
    defaultModel: "default", efforts: null,
    canReadCode: () => true,
    build: ({ bin, model, prompt }) => ({
      argv: [bin, "--approval-mode", "plan", "--skip-trust", "--extensions", "none", "--allowed-mcp-server-names", "none",
        "--output-format", "text", ...(model ? ["-m", model] : []), "-p", STDIN_INSTRUCTION],
      input: prompt,
    }),
  },

  // Cursor: ask mode (read-only), sandbox on. It only takes permissions from files, so we write our own
  // deny list into the checkout (after removing the PR's .cursor/). The prompt goes in a file: no stdin.
  cursor: {
    id: "cursor", label: "Cursor", bins: ["cursor-agent", "agent"], lockdown: "partial",
    models: ["default"], defaultModel: "default", efforts: null,
    canReadCode: () => true,
    build: ({ bin, model, workDir, prompt }) => ({
      argv: [bin, "-p", "--mode", "ask", "--sandbox", "enabled", "--trust", "--output-format", "text",
        "--workspace", workDir, ...(model ? ["--model", model] : []), FILE_INSTRUCTION],
      workFiles: {
        [PROMPT_FILE]: prompt,
        ".cursor/cli.json": JSON.stringify({
          permissions: { allow: ["Read(**)"], deny: ["Shell(*)", "Write(**)", "WebFetch(*)", "Mcp(*:*)"] },
        }, null, 2),
      },
    }),
  },

  // opencode: no plugins, and shell, edits, web and files outside the checkout are denied through its
  // config. Your provider config is still loaded (it holds your login), so "partial".
  opencode: {
    id: "opencode", label: "opencode", bins: ["opencode"], lockdown: "partial",
    models: ["default"], defaultModel: "default", efforts: null,
    canReadCode: () => true,
    build: ({ bin, model, workDir, prompt }) => ({
      argv: [bin, "run", "--pure", "--dir", workDir, ...(model ? ["-m", model] : []), FILE_INSTRUCTION],
      env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: { edit: "deny", bash: "deny", webfetch: "deny", external_directory: "deny" },
      }) },
      workFiles: { [PROMPT_FILE]: prompt },
    }),
  },
};

/** What the user's own `agent.command` runs as: the Claude flags logic, but no lockdown claim. */
const CUSTOM = { ...claude, id: "custom", label: "Custom command", bins: [], lockdown: "custom" };

export const AI_IDS = Object.keys(AGENTS);
export const getAgent = (id) => AGENTS[id] ?? null;
export const customAgent = () => CUSTOM;

/** Full path of the first of `names` found on PATH, or null. */
export function findOnPath(names, pathVar = process.env.PATH ?? "") {
  for (const dir of pathVar.split(path.delimiter).filter(Boolean)) {
    for (const n of names) {
      const f = path.resolve(dir, n); // absolute: the review runs in another folder
      try {
        if (fs.statSync(f).isFile()) { fs.accessSync(f, fs.constants.X_OK); return f; }
      } catch {}
    }
  }
  return null;
}

/** The AI CLIs installed here, in preference order (most locked down first): [{ id, bin }]. */
export function detectAgents(pathVar) {
  return AI_IDS.flatMap((id) => {
    const bin = findOnPath(AGENTS[id].bins, pathVar);
    return bin ? [{ id, bin }] : [];
  });
}

export const NO_AI_MESSAGE =
  "No AI CLI found. Install one of: Claude Code (claude), Codex (codex), Gemini CLI (gemini), Cursor (cursor-agent), opencode.";

/**
 * Which AI runs for these settings: { adapter, bin }. `ai: "auto"` takes the first installed one, unless the user
 * wrote their own agent.command (then that keeps working). Throws a readable error when it isn't installed.
 */
export function pickAgent(settings, pathVar) {
  const ai = settings.ai ?? "auto";
  if (ai === "auto" && settings.agentIsCustom) return { adapter: CUSTOM, bin: null };
  const found = detectAgents(pathVar);
  if (ai === "auto") {
    if (!found.length) throw new Error(NO_AI_MESSAGE);
    return { adapter: AGENTS[found[0].id], bin: found[0].bin };
  }
  const adapter = AGENTS[ai];
  if (!adapter) throw new Error(`unknown AI "${ai}" (use auto, ${AI_IDS.join(", ")})`);
  const hit = found.find((f) => f.id === ai);
  if (!hit) throw new Error(`${adapter.label} isn't installed (looked for ${adapter.bins.join(" or ")} on PATH)`);
  return { adapter, bin: hit.bin };
}

/** The command, env, input and files for one review. `ctx`: { bin, settings, codeAccess, workDir, tmp, prompt }. */
export function planRun(adapter, ctx) {
  const { settings } = ctx;
  const effort = adapter.efforts?.includes(settings.effort) ? settings.effort : null;
  const built = adapter.build({ ...ctx, model: modelArg(settings.model), effort });
  return { env: {}, input: "", workFiles: {}, ...built };
}

/** The model name to show for a review: what was passed on, or "default" when the AI picks its own. */
export const modelShown = (adapter, settings) =>
  adapter.id === "claude" || adapter.id === "custom" ? settings.model || "default" : modelArg(settings.model) ?? "default";

/** The model reply as text: usually stdout, but Codex writes its last message to a file. */
export const readReply = (adapter, stdout, plan) => (adapter.parse ? adapter.parse(stdout, plan) : stdout);

const DROP_FILES = new Set(["agents.md", "agents.override.md", "claude.md", "claude.local.md", "gemini.md",
  ".cursorrules", "opencode.json", "opencode.jsonc"]);
const DROP_DIRS = new Set([".cursor", ".gemini", ".opencode", ".codex", ".claude", ".agents"]);

/**
 * Make a PR checkout safe to hand to an AI: remove symlinks (they could point at your files) and the files
 * these CLIs load as instructions or settings (a PR could add them). The checkout is thrown away afterwards.
 * Returns the removed paths, relative to `dir`.
 */
export function hardenCheckout(dir) {
  const removed = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(d, e.name), rel = path.relative(dir, p), low = e.name.toLowerCase();
      if (e.isSymbolicLink() || (e.isFile() && DROP_FILES.has(low))) {
        fs.rmSync(p, { force: true });
        removed.push(rel);
      } else if (e.isDirectory()) {
        if (DROP_DIRS.has(low)) { fs.rmSync(p, { recursive: true, force: true }); removed.push(rel + "/"); }
        else walk(p);
      }
    }
  };
  walk(dir);
  return removed;
}
