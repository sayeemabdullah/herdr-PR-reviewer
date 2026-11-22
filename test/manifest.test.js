// Checks herdr-plugin.toml against herdr's plugin rules, without a TOML library.
// Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const toml = fs.readFileSync(new URL("../herdr-plugin.toml", import.meta.url), "utf8");
const top = toml.split(/^\[\[/m)[0];
const str = (src, key) => new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m").exec(src)?.[1];

test("required top-level fields are present", () => {
  for (const k of ["id", "name", "version", "min_herdr_version"]) assert.ok(str(top, k), `missing ${k}`);
  assert.match(str(top, "version"), /^\d+\.\d+\.\d+$/);
  assert.match(str(top, "min_herdr_version"), /^\d+\.\d+\.\d+$/);
});

test("plugin id uses only allowed characters", () => {
  assert.match(str(top, "id"), /^[A-Za-z0-9.:_-]+$/);
});

test("action and pane ids are valid (no dots) and unique", () => {
  for (const kind of ["actions", "panes"]) {
    const ids = toml.split(`[[${kind}]]`).slice(1).map((block) => str(block, "id"));
    for (const id of ids) assert.match(id, /^[A-Za-z0-9:_-]+$/, `${kind} id "${id}"`);
    assert.equal(new Set(ids).size, ids.length, `duplicate ${kind} id`);
  }
});

test("every command points at a file that exists", () => {
  for (const m of toml.matchAll(/^command\s*=\s*\["node",\s*"([^"]+)"/gm)) {
    assert.ok(fs.existsSync(new URL(`../${m[1]}`, import.meta.url)), `${m[1]} not found`);
  }
});
