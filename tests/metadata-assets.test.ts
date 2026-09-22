import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function assertPng(
  path: string,
  width: number,
  height: number,
): Promise<Buffer> {
  const image = await readFile(new URL(path, root));
  assert.equal(
    image.subarray(0, 8).equals(pngSignature),
    true,
    `${path} must be a PNG`,
  );
  assert.equal(
    image.subarray(12, 16).toString("ascii"),
    "IHDR",
    `${path} needs an IHDR`,
  );
  assert.equal(image.readUInt32BE(16), width, `${path} width`);
  assert.equal(image.readUInt32BE(20), height, `${path} height`);
  return image;
}

test("declared Apple and social metadata images are real PNGs at advertised dimensions", async () => {
  const [layout, apple, social] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    assertPng("public/apple-icon.png", 180, 180),
    assertPng("public/opengraph-image.png", 1200, 630),
  ]);

  assert.match(layout, /url:\s*"\/apple-icon\.png"/);
  assert.match(layout, /url:\s*"\/opengraph-image\.png"/);
  assert.match(layout, /images:\s*\["\/opengraph-image\.png"\]/);
  assert.notDeepEqual(
    apple,
    social,
    "Apple and social images must use their intended canvases",
  );
});
