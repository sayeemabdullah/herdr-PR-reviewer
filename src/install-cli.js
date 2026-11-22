// Action: put a `pr-inbox` command in ~/.local/bin, so the inbox opens from any terminal (e.g. the
// Herdr desktop app). It links to a launcher in the plugin's state dir that always finds the current
// plugin folder, so it keeps working after `herdr plugin update` moves the plugin.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LAUNCHER, notify, writeLauncher } from "./lib.js";

writeLauncher();
const bin = path.join(os.homedir(), ".local", "bin");
const target = path.join(bin, "pr-inbox");
fs.mkdirSync(bin, { recursive: true });

let stat = null;
try {
  stat = fs.lstatSync(target);
} catch {}
if (stat && !stat.isSymbolicLink()) {
  const msg = `${target} already exists and isn't a link, so I left it alone.`;
  console.log(msg);
  notify("pr-inbox not installed", msg, "none");
  process.exit(1);
}
fs.rmSync(target, { force: true });
fs.symlinkSync(LAUNCHER, target);

const onPath = (process.env.PATH ?? "").split(path.delimiter).includes(bin);
const msg = onPath
  ? "Type pr-inbox in any terminal to open the inbox."
  : `Installed ${target}. Add ${bin} to your PATH to type just pr-inbox.`;
console.log(msg);
notify("pr-inbox installed", msg, "done");
