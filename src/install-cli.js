// Action: put a `pr-panel` command in ~/.local/bin, so PR Panel opens from any terminal (e.g. the
// Herdr desktop app). It links to a launcher in the plugin's state dir that always finds the current
// plugin folder, so it keeps working after `herdr plugin update` moves the plugin.
import { installCli, notify } from "./lib.js";

const { ok, message } = installCli();
console.log(message);
notify(ok ? "pr-panel installed" : "pr-panel not installed", message, ok ? "done" : "none");
process.exit(ok ? 0 : 1);
