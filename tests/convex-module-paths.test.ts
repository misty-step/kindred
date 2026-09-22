import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";

const convex = new URL("../convex/", import.meta.url);

test("Convex modules use deployable path components", async () => {
  const entries = await readdir(convex, { recursive: true, withFileTypes: true });
  const invalid = entries
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => !/^[A-Za-z0-9_.]+$/.test(name));
  assert.deepEqual(invalid, []);
});
