import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const cwd = new URL(".", root);

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("Parlor skill provenance records the exact pinned gitlink and matching source hashes", async () => {
  const treeEntry = execFileSync("git", ["ls-tree", "HEAD", "vendor/parlor"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const match = /^160000 commit ([0-9a-f]{40})\tvendor\/parlor$/.exec(
    treeEntry,
  );
  assert.ok(match, "vendor/parlor must be a pinned gitlink");
  const revision = match[1];

  const [sourceText, skill, reference, vendorReference, importer] =
    await Promise.all([
      readFile(new URL(".agents/skills/parlor/SOURCE.json", root), "utf8"),
      readFile(new URL(".agents/skills/parlor/SKILL.md", root), "utf8"),
      readFile(new URL(".agents/skills/parlor/reference.md", root)),
      readFile(new URL("vendor/parlor/skills/parlor/SKILL.md", root)),
      readFile(new URL("vendor/parlor/scripts/import-skill.mjs", root)),
    ]);
  const source = JSON.parse(sourceText) as {
    framework: { revision: string };
    reference: { revision: string; sha256: string; differsFromCommit: boolean };
    importer: { baseRevision: string; sha256: string };
  };

  assert.equal(source.framework.revision, revision);
  assert.equal(source.reference.revision, revision);
  assert.equal(source.importer.baseRevision, revision);
  assert.equal(source.reference.differsFromCommit, false);
  assert.equal(source.reference.sha256, sha256(reference));
  assert.deepEqual(reference, vendorReference);
  assert.equal(source.reference.sha256, sha256(vendorReference));
  assert.equal(source.importer.sha256, sha256(importer));
  const recordedSource =
    "Installed source: `vendor/parlor` at `" + revision + "`.";
  assert.equal(skill.includes(recordedSource), true);
});
