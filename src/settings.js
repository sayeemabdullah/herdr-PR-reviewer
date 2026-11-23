// Settings shown in PR Panel (Settings and Repos tabs). Reads and writes config.json directly, keeping any keys it
// doesn't know about, and only writing a value when it differs from the default.
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, DEFAULTS, ROOT, loadConfig } from "./lib.js";

export const MODELS = ["opus", "fable", "sonnet", "haiku"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/**
 * The editable settings, in display order.
 *   bool:   on / off (labels for each)
 *   choice: cycles through `options`; "custom" lets you type any value (e.g. a full model name)
 *   number: typed in, between min and max
 *   text:   one line of text
 *   list:   comma separated values (`validate: "repo"` checks each is owner/repo)
 * A key like "agent.timeoutSeconds" is a value inside a group in config.json.
 */
export const FIELDS = [
  { section: "Reviews" },
  { key: "finalWord", type: "bool", label: "Final word", on: "you approve first (inbox)", off: "AI posts by itself" },
  { key: "model", type: "choice", label: "Model", options: MODELS, custom: true,
    help: "Claude model for reviews. Opus finds the most; Sonnet and Haiku are faster and cheaper." },
  { key: "effort", type: "choice", label: "Effort", options: EFFORTS,
    help: "How hard the model thinks. Higher is slower and costs more." },
  { key: "readCode", type: "bool", label: "Read the whole repo", on: "yes (read-only checkout)", off: "diff only" },
  { key: "allowApprove", type: "bool", label: "AI may approve", on: "yes", off: "never, only comment / request changes" },
  { key: "minSeverity", type: "choice", label: "Show comments", options: ["nit", "important", "blocker"],
    help: "nit = everything; important = hide nits; blocker = only what must be fixed. The summary is always kept." },
  { key: "repoRules", type: "bool", label: "Repo rules", on: "follow REVIEW.md in the repo", off: "ignore it" },
  { key: "resolveFixed", type: "bool", label: "Resolve fixed", on: "mark fixed comments resolved", off: "leave them open" },
  { key: "rereviewOnPush", type: "bool", label: "Re-review new commits", on: "yes", off: "no" },
  { key: "skipDrafts", type: "bool", label: "Skip draft PRs", on: "yes", off: "no" },
  { key: "instructions", type: "text", label: "Your instructions",
    help: "Extra things the reviewer should check, for every repo. One line here; press E for a longer text in the file." },
  { section: "Smarter model (cheaper reviews for small PRs)" },
  { key: "smartModel", type: "bool", label: "Smarter model", on: "cheaper model for small / docs PRs", off: "always the model above" },
  { key: "cheapModel", type: "choice", label: "Cheap model", options: MODELS, custom: true,
    help: "Used for small or docs-only PRs when Smarter model is on. Risky files always get the model above." },
  { key: "cheapEffort", type: "choice", label: "Cheap effort", options: EFFORTS, help: "Effort for the cheap model." },
  { key: "smallMaxLines", type: "number", label: "Small PR: most lines", min: 1, max: 5000, help: "Added plus removed lines. At or under this (and the file limit) a PR counts as small." },
  { key: "smallMaxFiles", type: "number", label: "Small PR: most files", min: 1, max: 100 },
  { key: "riskyPaths", type: "list", label: "Always full model for", help: "Paths (globs, comma separated). A PR touching one always gets your model and effort." },
  { key: "docsPaths", type: "list", label: "Docs paths", help: "Paths (globs, comma separated). A PR with only these files counts as docs-only." },
  { section: "Big PRs and diffs" },
  { key: "splitLarge", type: "bool", label: "Big PRs", on: "review in parts", off: "cut off at the diff limit" },
  { key: "maxDiffChars", type: "number", label: "Diff limit (characters)", min: 10000, max: 1000000, help: "The most diff one run reads. A longer diff is split into parts." },
  { key: "maxParts", type: "number", label: "Most parts", min: 1, max: 8, help: "A big PR is split into at most this many parts. Each part is a full AI run, so it costs that many reviews." },
  { key: "ignorePaths", type: "list", label: "Left out of the diff", help: "Paths (globs, comma separated) the AI doesn't see in the diff, such as lockfiles and build output." },
  { key: "agent.timeoutSeconds", type: "number", label: "Time limit (seconds)", min: 60, max: 7200, help: "A review that takes longer than this is stopped." },
  { section: "Watcher" },
  { key: "onlyListedRepos", type: "bool", label: "Which repos", on: "only the repos you listed", off: "also any repo you're asked on",
    help: "On: PRs from repos you haven't added (in the Repos tab) are ignored, even when you're asked to review them." },
  { key: "ignoreRepos", type: "list", label: "Never review these repos", validate: "repo", help: "owner/repo, comma separated. These are skipped even if listed or asked." },
  { key: "ignoreAuthors", type: "list", label: "Skip PRs from", help: "GitHub logins, comma separated, such as bots (dependabot[bot])." },
  { key: "pollSeconds", type: "number", label: "Check every (seconds)", min: 30, max: 86400 },
  { key: "maxParallel", type: "number", label: "Reviews at once", min: 1, max: 8 },
  { key: "autoStartWatcher", type: "bool", label: "Start with herdr", on: "the watcher opens by itself", off: "start it yourself" },
  { key: "desktopNotifications", type: "bool", label: "Desktop notifications", on: "macOS notifications too", off: "herdr notifications only" },
];

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

const getPath = (obj, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** The value in effect: what the file says, else the default. */
export const effective = (raw, key) => {
  const v = getPath(raw, key);
  return v !== undefined ? v : getPath(DEFAULTS, key);
};

/** Set a value; a value equal to the default is removed so the file stays short. Returns raw. */
export function setValue(raw, key, value) {
  const parts = key.split(".");
  const last = parts.pop();
  const isDefault = JSON.stringify(value) === JSON.stringify(getPath(DEFAULTS, key));
  let holder = raw;
  const trail = [];
  for (const p of parts) {
    if (holder[p] === undefined || holder[p] === null || typeof holder[p] !== "object") {
      if (isDefault) return raw; // nothing there to remove
      holder[p] = {};
    }
    trail.push([holder, p]);
    holder = holder[p];
  }
  if (isDefault) delete holder[last];
  else holder[last] = value;
  // a group left empty by removing its last value goes away too
  for (const [parent, p] of trail.reverse()) if (Object.keys(parent[p]).length === 0) delete parent[p];
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

/** Comma separated text to a list: trimmed, empties dropped, repeats dropped. A field with validate: "repo" checks owner/repo. */
export function parseList(field, text) {
  const items = [...new Set(String(text).split(",").map((t) => t.trim()).filter(Boolean))];
  if (field.validate === "repo") return items.map((t) => parseRepo(t));
  return items;
}

/** A list or text value as one line for showing and editing. */
export const listText = (v) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));

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
