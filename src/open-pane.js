// Action entrypoint: open (or focus, if already running) one of the plugin's panes.
import fs from "node:fs";
import { HERDR, PLUGIN_ID, WATCHER_FILE, isAlive, run } from "./lib.js";

const entry = process.argv[2] ?? "watcher";
const focus = !process.argv.includes("--no-focus");

if (entry === "watcher") {
  try {
    const w = JSON.parse(fs.readFileSync(WATCHER_FILE, "utf8"));
    if (isAlive(w.pid)) {
      if (focus && w.paneId) run(HERDR, ["plugin", "pane", "focus", w.paneId], { allowFail: true });
      process.exit(0);
    }
  } catch {}
}

run(HERDR, [
  "plugin", "pane", "open",
  "--plugin", PLUGIN_ID,
  "--entrypoint", entry,
  "--placement", entry === "watcher" ? "tab" : "overlay",
  focus ? "--focus" : "--no-focus",
]);
