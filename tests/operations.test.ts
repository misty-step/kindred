import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHealthHandler } from "../app/api/health/handler.ts";
import { redactSentryEvent } from "../app/sentry-privacy.ts";
import { resolveSentryOptions } from "../app/sentry-runtime.ts";
import { resolveRuntimeAttribution } from "../app/runtime-config.ts";

const productionRelease = "0123456789abcdef0123456789abcdef01234567";
const localEnv = {
  PRODUCT_ENVIRONMENT: "test",
  SENTRY_RELEASE: "local",
  KINDRED_LOCAL: "true",
  NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:3211",
};

test("runtime attribution is explicit and production releases are exact commits", () => {
  assert.deepEqual(resolveRuntimeAttribution(localEnv), {
    environment: "test",
    release: "local",
  });
  assert.throws(
    () => resolveRuntimeAttribution({ PRODUCT_ENVIRONMENT: "production" }),
    /SENTRY_RELEASE/,
  );
  assert.throws(
    () =>
      resolveRuntimeAttribution({
        PRODUCT_ENVIRONMENT: "production",
        SENTRY_RELEASE: "kindred@2026.09.22",
      }),
    /40-character/,
  );
  assert.deepEqual(
    resolveRuntimeAttribution({
      PRODUCT_ENVIRONMENT: "production",
      SENTRY_RELEASE: productionRelease,
    }),
    { environment: "production", release: productionRelease },
  );
});

test("Sentry enables attributed low-volume traces only with a valid project DSN", () => {
  assert.deepEqual(
    resolveSentryOptions(
      {
        PRODUCT_ENVIRONMENT: "production",
        SENTRY_RELEASE: productionRelease,
        SENTRY_DSN: "https://public@example.ingest.sentry.io/123",
      },
      "server",
    ),
    {
      dsn: "https://public@example.ingest.sentry.io/123",
      enabled: true,
      environment: "production",
      release: productionRelease,
      sendDefaultPii: false,
      tracesSampleRate: 0.05,
    },
  );
  assert.equal(resolveSentryOptions(localEnv, "server").enabled, false);
});

test("Sentry redaction removes player and request identity but preserves trace mechanics", () => {
  const event = redactSentryEvent({
    user: { email: "player@example.test", ip_address: "127.0.0.1" },
    request: {
      method: "POST",
      url: "https://kindred.mistystep.io/?room=SECR",
      headers: { cookie: "secret" },
      data: { answer: "private thought" },
    },
    breadcrumbs: [{ message: "private thought" }],
    extra: { token: "secret" },
    contexts: {
      trace: { trace_id: "0123456789abcdef0123456789abcdef" },
      device: { name: "phone" },
    },
    tags: { runtime: "browser", playerName: "Ada" },
  });
  assert.deepEqual(event.user, undefined);
  assert.deepEqual(event.request, {
    method: "POST",
    url: "https://kindred.mistystep.io/",
  });
  assert.deepEqual(event.contexts, {
    trace: { trace_id: "0123456789abcdef0123456789abcdef" },
  });
  assert.deepEqual(event.tags, { runtime: "browser" });
  assert.equal(event.breadcrumbs, undefined);
  assert.equal(event.extra, undefined);
  assert.doesNotMatch(
    JSON.stringify(event),
    /player@example|SECR|private thought|phone|Ada|secret/,
  );
});

test("health reports exact attribution only after the Convex backend contract passes", async () => {
  const fetchMock = async () =>
    Response.json({ status: "ok", service: "kindred-backend" });
  const response = await createHealthHandler({
    fetch: fetchMock as typeof fetch,
    now: () => new Date("2026-09-22T06:00:00.000Z"),
    env: localEnv,
  })();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "kindred",
    environment: "test",
    release: "local",
    checkedAt: "2026-09-22T06:00:00.000Z",
    dependencies: { backend: "ok" },
  });
});

test("health fails closed without reflecting backend details", async () => {
  const response = await createHealthHandler({
    fetch: (async () =>
      Response.json({
        status: "ok",
        service: "wrong-secret-backend",
      })) as typeof fetch,
    now: () => new Date("2026-09-22T06:00:00.000Z"),
    env: localEnv,
  })();
  assert.equal(response.status, 503);
  assert.doesNotMatch(
    JSON.stringify(await response.json()),
    /wrong|secret|dsn|token/i,
  );
});

test("operations registration consumes the approved game-operations interface", async () => {
  const registration = JSON.parse(
    await readFile(
      new URL("../config/game-operations.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(registration.game, "kindred");
  assert.equal(
    registration.approvedOpsRef,
    "misty-step/hermes-config@5241de4b93ac68348d4a48a87f9d38750f55af88",
  );
  assert.deepEqual(registration.productEvents, {
    contract: "product-events/v1",
    store: "convex",
    environmentVariable: "PRODUCT_ENVIRONMENT",
    contentPolicy: "no-player-text",
    actorPolicy: "anonymous-null",
  });
  assert.deepEqual(registration.sentry.triage, {
    route: "sentry-games",
    adapter: "scripts/sentry/sentry-game-filter.py",
    status: "prepared-not-activated",
    activationOwner: "t_089aca22",
  });
  assert.equal(registration.sentry.projectSlug, "kindred");
  assert.equal(registration.health.path, "/api/health");
});
