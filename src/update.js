// Updates: look for a newer GitHub release of this plugin, show what's new, and install it.
//
//   node src/update.js              check GitHub now and say whether there is a newer release
//   node src/update.js --install    install the newest release (same as the Update tab)
//
// Only ever installs a published release tag (vX.Y.Z) that is NEWER than what you have, from this repo, with herdr's own
// `plugin install`. Never master, never a downgrade, never a plugin you linked from a local folder.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { HERDR, PLUGIN_ID, ROOT, STATE_DIR, WATCHER_FILE, listActiveReviews, notify, run } from "./lib.js";

export const UPDATE_REPO = "sayeemabdullah/herdr-PR-reviewer";
const STATE_FILE = path.join(STATE_DIR, "update.json");
const LOCK_FILE = path.join(STATE_DIR, "update.lock");
const RESTART_FILE = path.join(STATE_DIR, "restart-requested");
const CHECK_EVERY_MS = 6 * 3600 * 1000; // how often the watcher asks GitHub
const RETRY_AFTER_ERROR_MS = 30 * 60 * 1000;
const RETRY_FAILED_UPDATE_MS = 6 * 3600 * 1000; // after a failed install of a version, wait before trying it again
const TAG_RE = /^v\d+\.\d+\.\d+$/;

const lastLine = (s) => String(s ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";

// ---------- versions ----------

/** "0.6.0" or "v0.6.0" -> [0, 6, 0], or null when it isn't a plain x.y.z version. */
export function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(s ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1, 0 or 1. Throws on something that isn't x.y.z, so a bad value can never count as "newer". */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`can't compare "${a}" and "${b}"`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** The version in a plugin folder's herdr-plugin.toml, or null. */
export function installedVersion(root = ROOT) {
  try {
    return /^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(root, "herdr-plugin.toml"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * From GitHub's release list: the published, plain vX.Y.Z releases that are newer than `installed`, newest first.
 * Drafts, pre-releases, odd tags and anything not newer are dropped.
 */
export function pickUpdates(releases, installed) {
  if (!Array.isArray(releases) || !parseVersion(installed)) return [];
  return releases
    .filter((r) => r && !r.draft && !r.prerelease && TAG_RE.test(r.tag_name ?? "") && compareVersions(r.tag_name, installed) > 0)
    .map((r) => ({
      tag: r.tag_name, version: r.tag_name.slice(1), name: r.name || r.tag_name,
      body: String(r.body ?? "").trim(), url: r.html_url ?? "", publishedAt: r.published_at ?? "",
    }))
    .sort((a, b) => compareVersions(b.tag, a.tag));
}

// ---------- remembered state ----------

export function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeUpdateState(patch) {
  const next = { ...readUpdateState(), ...patch };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE + ".tmp", JSON.stringify(next, null, 2));
  fs.renameSync(STATE_FILE + ".tmp", STATE_FILE);
  return next;
}

// ---------- checking ----------

function fetchReleases() {
  const r = run("gh", ["api", `repos/${UPDATE_REPO}/releases?per_page=15`], { allowFail: true, timeoutMs: 30000 });
  if (!r.ok) throw new Error(lastLine(r.stderr) || "GitHub didn't answer");
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error("GitHub's answer wasn't readable");
  }
}

/**
 * Ask GitHub for newer releases, at most once per `maxAgeMs` unless `force`. A failed check is remembered and retried
 * after 30 minutes, never thrown. Returns the remembered state: { checkedAt, installed, latest, releases, error, ... }.
 */
export function checkForUpdate({ force = false, maxAgeMs = CHECK_EVERY_MS, root = ROOT, now = Date.now(), fetch = fetchReleases } = {}) {
  const st = readUpdateState();
  const installed = installedVersion(root);
  const same = st.installed === installed;
  if (!force && same && st.checkedAt && now - st.checkedAt < maxAgeMs) return st;
  if (!force && same && st.failedAt && now - st.failedAt < RETRY_AFTER_ERROR_MS) return st;
  try {
    const releases = pickUpdates(fetch(), installed);
    return writeUpdateState({ checkedAt: now, failedAt: null, error: null, installed, releases, latest: releases[0]?.version ?? null });
  } catch (e) {
    return writeUpdateState({ failedAt: now, error: String(e.message).split("\n")[0], installed, ...(same ? {} : { releases: [], latest: null }) });
  }
}

// ---------- how it was installed ----------

/**
 * Where herdr got this plugin: { kind: "github" | "other" | "unknown", repo, ref, source, canUpdate }.
 * Only a GitHub install of this very repo can be updated here; a plugin you linked from a folder is yours to update with git.
 */
export function installSource() {
  const r = run(HERDR, ["plugin", "list"], { allowFail: true, timeoutMs: 15000 });
  const line = r.ok ? r.stdout.split("\n").find((l) => l.startsWith(`- ${PLUGIN_ID} `)) : null;
  const src = line ? /\[([^\]]+)\]\s*$/.exec(line.trim())?.[1] : null;
  const g = /^github:([^@]+)@(.+)$/.exec(src ?? "");
  if (g) return { kind: "github", repo: g[1], ref: g[2], source: src, canUpdate: g[1].toLowerCase() === UPDATE_REPO.toLowerCase() };
  return { kind: src ? "other" : "unknown", source: src ?? null, canUpdate: false };
}

/** Why this install can't be updated here, in a sentence. */
export function cannotUpdateReason(src) {
  if (src?.kind === "github") return `It was installed from ${src.repo}, not ${UPDATE_REPO}.`;
  if (src?.kind === "other") return "It is linked from a local folder, so update it there (git pull).";
  return "herdr didn't say where this plugin came from.";
}

// ---------- installing ----------

function takeLock() {
  try {
    const held = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
    let alive = false;
    try { process.kill(held.pid, 0); alive = true; } catch {}
    if (alive && Date.now() - fs.statSync(LOCK_FILE).mtimeMs < 10 * 60 * 1000) return false;
  } catch {}
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid }));
  return true;
}
const releaseLock = () => fs.rmSync(LOCK_FILE, { force: true });

const herdrInstall = (tag) => run(HERDR, ["plugin", "install", UPDATE_REPO, "--ref", tag, "-y"], { allowFail: true, timeoutMs: 180000 });

/**
 * Install release `tag`. Checks it is a plain vX.Y.Z, newer than what is installed, and that this is a GitHub install of this
 * repo. Afterwards the plugin folder must really say that version; if not, the old version is put back. On success it asks
 * the watcher to restart on the new code. Throws a readable error otherwise. Returns { from, to }.
 */
export function applyUpdate(tag, { root = ROOT, install = herdrInstall, source = installSource } = {}) {
  if (!TAG_RE.test(String(tag))) throw new Error(`"${tag}" isn't a release version`);
  const from = installedVersion(root);
  if (!from) throw new Error("couldn't read the installed version");
  if (compareVersions(tag, from) <= 0) throw new Error(`${tag} isn't newer than ${from}`);
  const src = source();
  if (!src.canUpdate) throw new Error(cannotUpdateReason(src));
  if (!takeLock()) throw new Error("an update is already running");
  try {
    const res = install(tag);
    const now = installedVersion(root);
    if (!res.ok || now !== tag.slice(1)) {
      let restored = "";
      if (now !== from) { // it left something else behind: put the old one back, and say so if that fails too
        let back = null;
        try { back = install(`v${from}`); } catch {}
        if (!back?.ok || installedVersion(root) !== from) restored = ` (and couldn't put ${from} back: run herdr plugin install ${UPDATE_REPO} --ref v${from})`;
      }
      throw new Error((res.ok ? `installed, but the plugin still says ${now}` : `herdr couldn't install ${tag}: ${lastLine(res.stderr || res.stdout)}`) + restored);
    }
    fs.writeFileSync(RESTART_FILE, JSON.stringify({ version: tag, at: Date.now() }));
    writeUpdateState({ lastUpdate: { from, to: tag.slice(1), at: Date.now() }, installed: tag.slice(1), releases: [], latest: null, failedTag: null, updateError: null });
    return { from, to: tag.slice(1) };
  } finally {
    releaseLock();
  }
}

// ---------- the watcher ----------

/** The watcher should start again on the new code, once no review is running. */
export const restartRequested = () => fs.existsSync(RESTART_FILE);

/**
 * Start a fresh watcher and let the caller exit. The old watcher's pid file goes first, so the new one doesn't think
 * it is still running.
 */
export function restartWatcher({ spawnFn = spawn } = {}) {
  fs.rmSync(RESTART_FILE, { force: true });
  fs.rmSync(WATCHER_FILE, { force: true });
  const child = spawnFn(process.execPath, [path.join(ROOT, "src", "open-pane.js"), "watcher", "--no-focus"], { detached: true, stdio: "ignore" });
  child.unref?.();
}

/**
 * One look at updates, from the watcher's loop. Returns what happened: "off", "current", "available" (you were told),
 * "notified", "waiting" (a review is running), "updated", "cannot" or "failed: ...".
 * Never throws.
 */
export function autoUpdateStep(cfg, { check = checkForUpdate, apply = applyUpdate, tell = notify, active = listActiveReviews, source = installSource } = {}) {
  try {
    if (!cfg.checkForUpdates) return "off";
    const st = check();
    const next = st.releases?.[0];
    if (!next) return "current";
    if (cfg.autoUpdate) {
      if (st.failedTag === next.tag && Date.now() - (st.failedUpdateAt ?? 0) < RETRY_FAILED_UPDATE_MS) return "failed: waiting before trying again";
      if (active().length) return "waiting";
      if (!source().canUpdate) return "cannot";
      try {
        apply(next.tag);
        return "updated";
      } catch (e) {
        writeUpdateState({ failedTag: next.tag, failedUpdateAt: Date.now(), updateError: String(e.message).split("\n")[0] });
        return `failed: ${String(e.message).split("\n")[0]}`;
      }
    }
    if (st.notified !== next.version) {
      tell("PR Reviewer update", `${next.version} is available. Open PR Panel and go to Update (u).`, "none", { desktop: cfg.desktopNotifications });
      writeUpdateState({ notified: next.version });
      return "notified";
    }
    return "available";
  } catch (e) {
    return `failed: ${String(e.message).split("\n")[0]}`;
  }
}

// ---------- command line ----------

async function main() {
  const args = process.argv.slice(2);
  const st = checkForUpdate({ force: true });
  const now = installedVersion();
  console.log(`PR Reviewer ${now}`);
  if (st.error) { console.error(`✗ couldn't check for updates: ${st.error}`); process.exit(1); }
  const next = st.releases?.[0];
  if (!next) { console.log("✓ you're up to date"); return; }
  console.log(`↑ ${next.version} is available (${next.url})`);
  if (!args.includes("--install")) { console.log("  Install it with: pr-panel update --install"); return; }
  try {
    const r = applyUpdate(next.tag);
    console.log(`✓ updated ${r.from} → ${r.to}. The watcher restarts by itself. Reopen PR Panel to use it.`);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
