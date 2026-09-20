/**
 * Kindred Cloudflare deploy (Poppycock pattern; proven in release lane
 * t_85fb54df). Run from a repo checkout, anywhere:
 *
 *   node scripts/deploy-cloudflare.mjs              — full build + deploy
 *   node scripts/deploy-cloudflare.mjs --build-only — build without deploying
 *
 * Parks .env.local so the OpenNext build uses the production environment
 * values below, builds with OPEN_NEXT_DEBUG=1 (esbuild minify stays off —
 * Effect TypeIds are Symbols; see open-next.config.ts), patches the emitted
 * openNextDebug flag back to false, then deploys the worker.
 *
 * Secrets are never read or written here. Worker secrets are set separately
 * with `wrangler secret put` after the worker exists.
 */
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildOnly = process.argv.includes("--build-only");
const localEnv = join(root, ".env.local");
const parked = join(root, ".env.local.kindred-cf-park");

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

/**
 * Node-middleware bundles bake `openNextDebug = true` when OPEN_NEXT_DEBUG is
 * set. Disable it in the emitted output so production runs without debug
 * logging. Kindred has no middleware.ts, so the flag may be absent — that is
 * reported, not fatal.
 */
async function disableOpenNextDebug(directory) {
  const stack = [directory];
  let patched = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.name.endsWith(".js") && !entry.name.endsWith(".mjs")) continue;
      const original = await readFile(path, "utf8");
      if (!original.includes("openNextDebug = true")) continue;
      const next = original.replaceAll("openNextDebug = true", "openNextDebug = false");
      if (next.includes("openNextDebug = true")) {
        throw new Error(`${path} still enables OpenNext debug after rewrite.`);
      }
      await writeFile(path, next);
      patched += 1;
    }
  }
  console.log(`openNextDebug patch: ${patched} file(s) rewritten`);
}

const env = {
  ...process.env,
  NEXT_PUBLIC_CONVEX_URL: "https://clear-dalmatian-864.convex.cloud",
  NEXT_PUBLIC_CONVEX_SITE_URL: "https://clear-dalmatian-864.convex.site",
  PARLOR_GUEST_TOKEN_AUDIENCE: "kindred",
  PARLOR_APP_ORIGIN: "https://kindred.mistystep.io",
  // Disables OpenNext esbuild minify; Effect TypeIds are Symbols.
  OPEN_NEXT_DEBUG: "1",
};
delete env.CONVEX_DEPLOYMENT;
delete env.CONVEX_AGENT_MODE;
delete env.CONVEX_DEPLOY_KEY;
delete env.PARLOR_GUEST_TOKEN_KEYS;
delete env.PARLOR_CONTINUITY_SECRET;

let parkedLocal = false;
try {
  try {
    await rename(localEnv, parked);
    parkedLocal = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rm(join(root, ".open-next"), { recursive: true, force: true });
  await run("pnpm", ["exec", "opennextjs-cloudflare", "build"], env);
  await disableOpenNextDebug(join(root, ".open-next"));
  if (!buildOnly) {
    await run("pnpm", ["exec", "opennextjs-cloudflare", "deploy"], env);
  }
} finally {
  if (parkedLocal) await rename(parked, localEnv);
}
