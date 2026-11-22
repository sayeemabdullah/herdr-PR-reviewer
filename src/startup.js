// Startup hook: start the watcher in the background tab if configured.
import { spawnSync } from "node:child_process";
import { CONFIG_FILE, installCli, loadConfig, notify, writeLauncher } from "./lib.js";

writeLauncher();
// pr-inbox was renamed to pr-panel: swap the command if the old one is installed.
try {
  const { message } = installCli({ onlyIfOld: true });
  if (message) notify("PR Reviewer", message, "none");
} catch {}

const cfg = loadConfig();
if (cfg.missing) {
  notify("PR Reviewer not configured", `Add repos to ${CONFIG_FILE}`, "none");
} else if (cfg.autoStartWatcher) {
  spawnSync(process.execPath, [new URL("./open-pane.js", import.meta.url).pathname, "watcher", "--no-focus"], {
    stdio: "inherit",
  });
}
