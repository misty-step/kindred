import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("brand ships editable square and 16-first optical marks", async () => {
  const [large, small, favicon] = await Promise.all([
    source("brand/kindred-mark.svg"),
    source("brand/kindred-mark-16.svg"),
    source("app/icon.svg"),
  ]);
  for (const [name, svg] of [
    ["large", large],
    ["small", small],
    ["favicon", favicon],
  ] as const) {
    assert.match(
      svg,
      /viewBox="0 0 (?:16|64|512) (?:16|64|512)"/,
      `${name} must be square`,
    );
    assert.doesNotMatch(
      svg,
      /<text\b/i,
      `${name} must be a non-wordmark symbol`,
    );
  }
  assert.notEqual(
    large,
    small,
    "16px mark must be an optical variant, not a scaled copy",
  );
  assert.equal(
    favicon,
    small,
    "served favicon must use the 16-first optical source",
  );
});

test("share metadata and icons are wired in the root layout", async () => {
  const layout = await source("app/layout.tsx");
  assert.match(layout, /metadataBase/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /twitter/);
  assert.match(layout, /icons/);
  assert.match(layout, /Kindred/);
});

test("player surfaces contain no browser identity or engineering explanations", async () => {
  const paths = [
    "app/page.tsx",
    "app/room-view.tsx",
    "app/room-boundary.tsx",
    "app/providers.tsx",
    "app/error-message.ts",
  ];
  const copy = (await Promise.all(paths.map(source))).join("\n");
  for (const leak of [
    "Browser identity",
    "Access tokens stay in memory",
    "signed cookie",
    "Player ID",
    "exact contextual equivalence",
    "development backend",
    "localhost link",
    "issuer configuration",
  ]) {
    assert.equal(copy.includes(leak), false, `player copy leaks: ${leak}`);
  }
});

test("Fireflies tokens and Fraunces display type are part of the real surface", async () => {
  const css = await source("app/globals.css");
  assert.match(css, /--night:\s*#[0-9a-f]{6}/i);
  assert.match(css, /--amber:\s*#[0-9a-f]{6}/i);
  assert.match(css, /--teal:\s*#[0-9a-f]{6}/i);
  assert.match(css, /Fraunces/);
  assert.match(css, /prefers-reduced-motion/);
});

test("mobile ambience cannot widen the viewport and disabled actions read as unavailable", async () => {
  const css = await source("app/globals.css");
  assert.match(css, /\.ambient-light--teal\s*\{[^}]*right:\s*0;/s);
  assert.doesNotMatch(css, /\.shell\s*\{[^}]*overflow-x:/s);
  assert.match(css, /\.panel\s*\{[^}]*overflow:\s*clip;/s);
  assert.match(
    css,
    /button:disabled\s*\{[^}]*background:\s*var\(--night-raised\)/s,
  );
});
