import { resolveRuntimeAttribution } from "../../runtime-config.ts";

const BACKEND_TIMEOUT_MS = 3_000;

type HealthDependencies = {
  fetch: typeof fetch;
  now: () => Date;
  env: Record<string, string | undefined>;
};

function backendHealthUrl(environment: Record<string, string | undefined>): URL {
  const raw = environment["NEXT_PUBLIC_CONVEX_SITE_URL"];
  if (!raw) throw new Error("NEXT_PUBLIC_CONVEX_SITE_URL is required");
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("NEXT_PUBLIC_CONVEX_SITE_URL must be a credential-free origin");
  }
  const localHttp =
    environment["KINDRED_LOCAL"] === "true" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Convex health requires HTTPS outside isolated local mode");
  }
  return new URL("/health", url);
}

function validBackendHealth(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === 2 &&
    (value as Record<string, unknown>)["status"] === "ok" &&
    (value as Record<string, unknown>)["service"] === "kindred-backend"
  );
}

export function createHealthHandler(
  dependencies: HealthDependencies = {
    fetch,
    now: () => new Date(),
    env: process.env,
  },
) {
  return async function healthHandler(): Promise<Response> {
    const checkedAt = dependencies.now().toISOString();
    try {
      const attribution = resolveRuntimeAttribution(dependencies.env);
      const response = await dependencies.fetch(backendHealthUrl(dependencies.env), {
        cache: "no-store",
        signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      });
      if (!response.ok || !validBackendHealth(await response.json())) {
        throw new Error("Convex health contract failed");
      }
      return Response.json(
        {
          status: "ok",
          service: "kindred",
          ...attribution,
          checkedAt,
          dependencies: { backend: "ok" },
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return Response.json(
        { status: "unhealthy", service: "kindred", checkedAt },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

export const GET = createHealthHandler();
