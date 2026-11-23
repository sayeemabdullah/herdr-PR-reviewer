// Settings shown in PR Panel (Settings and Repos tabs). Reads and writes config.json directly, keeping any keys it
// doesn't know about, and only writing a value when it differs from the default.
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, DEFAULTS, ROOT, loadConfig } from "./lib.js";
import { CLAUDE_EFFORTS, CLAUDE_MODELS, customAgent, detectAgents, getAgent } from "./agents.js";

export const MODELS = CLAUDE_MODELS;
export const EFFORTS = CLAUDE_EFFORTS;

/**
 * The editable settings, in display order.
 *   bool:   on / off (labels for each)
 *   choice: cycles through `options`; "custom" lets you type any value (e.g. a full model name)
 *   number: typed in, between min and max
 */
export const FIELDS = [
  { section: "Reviews" },
  { key: "ai", type: "choice", label: "AI", optionsFor: (raw) => aiOptions(raw),
    help: "Which AI writes the reviews. auto = the first one installed. Switching resets the model." },
  { key: "finalWord", type: "bool", label: "Final word", on: "you approve first (inbox)", off: "AI posts by itself" },
  { key: "model", type: "choice", label: "Model", optionsFor: (raw) => modelOptions(raw), custom: true,
    help: "The AI's model. \"default\" is the AI's own choice. Press t to type any model name." },
  { key: "effort", type: "choice", label: "Effort", optionsFor: (raw) => effortOptions(raw),
    help: "How hard the model thinks. Higher is slower and costs more." },
  { key: "readCode", type: "bool", label: "Read the whole repo", on: "yes (read-only checkout)", off: "diff only" },
  { key: "allowApprove", type: "bool", label: "AI may approve", on: "yes", off: "never, only comment / request changes" },
  { key: "minSeverity", type: "choice", label: "Show comments", options: ["nit", "important", "blocker"],
    help: "nit = everything; important = hide nits; blocker = only what must be fixed. The summary is always kept." },
  { key: "repoRules", type: "bool", label: "Repo rules", on: "follow REVIEW.md in the repo", off: "ignore it" },
  { key: "rereviewOnPush", type: "bool", label: "Re-review new commits", on: "yes", off: "no" },
  { key: "skipDrafts", type: "bool", label: "Skip draft PRs", on: "yes", off: "no" },
  { section: "Watcher" },
  { key: "pollSeconds", type: "number", label: "Check every (seconds)", min: 30, max: 86400 },
  { key: "maxParallel", type: "number", label: "Reviews at once", min: 1, max: 8 },
  { key: "onlyListedRepos", type: "bool", label: "Which repos", on: "only the repos below", off: "any repo where you're asked to review" },
  { key: "desktopNotifications", type: "bool", label: "Desktop notifications", on: "macOS notifications too", off: "herdr notifications only" },
];

// ---------- which AI ----------

/** Options for a choice field: fixed, or depending on the config (the AI decides which models exist). */
export const fieldOptions = (f, raw) => (f.optionsFor ? f.optionsFor(raw) : f.options);

/** The adapter in effect for the whole config, or for one repo: the chosen AI, else the first installed, else Claude. */
export function adapterFor(raw, repo) {
  const r = repo ? repoList(raw).find((x) => x.repo.toLowerCase() === repo.toLowerCase()) : null;
  const ai = r?.ai ?? effective(raw, "ai");
  if (ai !== "auto") return getAgent(ai) ?? getAgent("claude");
  if (raw.agent?.command || raw.agent?.codeCommand) return customAgent();
  const first = detectAgents()[0];
  return getAgent(first?.id ?? "claude");
}

/** "auto", then every AI CLI that is installed (plus the one picked, if it has gone missing). */
export function aiOptions(raw) {
  const ids = detectAgents().map((a) => a.id);
  const cur = effective(raw, "ai");
  return ["auto", ...ids, ...(cur !== "auto" && !ids.includes(cur) ? [cur] : [])];
}

export const modelOptions = (raw, repo) => adapterFor(raw, repo).models;
/** [] when this AI has no effort setting. */
export const effortOptions = (raw, repo) => adapterFor(raw, repo).efforts ?? [];

/** Why a setting can't be changed with this AI, or null. An AI that can't be locked down always waits for you. */
export function lockedReason(raw, key, repo) {
  const a = adapterFor(raw, repo);
  if (a.lockdown !== "partial" || (key !== "finalWord" && key !== "allowApprove")) return null;
  return `${a.label} can read files outside the PR, so ${key === "finalWord" ? "reviews always wait for you" : "it never approves"}.`;
}

/** What really happens for a setting: an AI that can't be locked down always waits for you and never approves. */
export const forcedValue = (raw, key, value, repo) =>
  lockedReason(raw, key, repo) ? key === "finalWord" : value;

/**
 * Choose the AI. Its models and efforts differ, so the model goes back to that AI's default, an effort it
 * doesn't have is dropped, and per-repo models (which belong to the old AI) are cleared.
 */
export function setAI(raw, ai) {
  setValue(raw, "ai", ai);
  const a = adapterFor(raw);
  setValue(raw, "model", a.defaultModel);
  if (!a.efforts || !a.efforts.includes(effective(raw, "effort"))) delete raw.effort;
  if (raw.repos) raw.repos = repoList(raw).map(({ model: _drop, ...r }) => r);
  return raw;
}

/** The config file as written (no defaults merged in), created from the example on first use. */
export function readRaw(file = CONFIG_FILE) {
  if (!fs.existsSync(file)) fs.copyFileSync(path.join(ROOT, "config.example.json"), file);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Write atomically, then check it still loads, putting the old file back if it doesn't. */
export function writeRaw(raw, file = CONFIG_FILE) {
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  fs.writeFileSync(file + ".tmp", JSON.stringify(raw, null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
  if (file !== CONFIG_FILE) return;
  try {
    loadConfig();
  } catch (e) {
    if (before !== null) fs.writeFileSync(file, before);
    throw e;
  }
}

/** The value in effect: what the file says, else the default. */
export const effective = (raw, key) => (raw[key] !== undefined ? raw[key] : DEFAULTS[key]);

/** Set a value; a value equal to the default is removed so the file stays short. Returns raw. */
export function setValue(raw, key, value) {
  if (JSON.stringify(value) === JSON.stringify(DEFAULTS[key])) delete raw[key];
  else raw[key] = value;
  return raw;
}

/** Next (dir = 1) or previous (dir = -1) option for a choice; a custom value goes to the first. */
export function cycle(options, value, dir = 1) {
  const i = options.indexOf(value);
  if (i < 0) return options[0];
  return options[(i + dir + options.length) % options.length];
}

/** Check a typed number against the field's limits. Returns the number or throws a readable error. */
export function parseNumber(field, text) {
  const n = Number(String(text).trim());
  if (!Number.isInteger(n)) throw new Error(`${field.label} must be a whole number`);
  if (n < field.min || n > field.max) throw new Error(`${field.label} must be between ${field.min} and ${field.max}`);
  return n;
}

/** Repos in the file, normalised to objects, without the example placeholders. */
export function repoList(raw) {
  return (raw.repos ?? [])
    .map((r) => (typeof r === "string" ? { repo: r } : r))
    .filter((r) => r?.repo && !r.repo.startsWith("your-"));
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Accepts "owner/repo" or a github.com URL. Returns "owner/repo" or throws. */
export function parseRepo(text) {
  const t = String(text).trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .split("/").slice(0, 2).join("/");
  if (!REPO_RE.test(t)) throw new Error("Use owner/repo, e.g. my-org/api, or the repo's GitHub URL");
  return t;
}

export function addRepo(raw, text, review = "requested") {
  const repo = parseRepo(text);
  const list = repoList(raw);
  if (list.some((r) => r.repo.toLowerCase() === repo.toLowerCase())) throw new Error(`${repo} is already listed`);
  raw.repos = [...list, { repo, review }];
  return raw;
}

export function removeRepo(raw, repo) {
  raw.repos = repoList(raw).filter((r) => r.repo.toLowerCase() !== repo.toLowerCase());
  return raw;
}

/** Change one setting of one repo. A value of undefined removes the override (uses the global one). */
export function setRepoValue(raw, repo, key, value) {
  raw.repos = repoList(raw).map((r) => {
    if (r.repo.toLowerCase() !== repo.toLowerCase()) return r;
    const next = { ...r };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  });
  return raw;
}
