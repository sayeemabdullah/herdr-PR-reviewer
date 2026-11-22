// Startup hook: start the watcher in the background tab if configured.
import { spawnSync } from "node:child_process";
import { CONFIG_FILE, loadConfig, notify } from "./lib.js";

const cfg = loadConfig();
if (cfg.missing) {
  notify("PR Reviewer not configured", `Add repos to ${CONFIG_FILE}`, "none");
} else if (cfg.autoStartWatcher) {
  spawnSync(process.execPath, [new URL("./open-pane.js", import.meta.url).pathname, "watcher", "--no-focus"], {
    stdio: "inherit",
  });
}
