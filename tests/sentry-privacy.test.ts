import assert from "node:assert/strict";
import test from "node:test";
import { redactSentryEvent } from "../app/sentry-privacy.ts";

const roomCanary = "PRIVATE-ROOM-FCQR";
const answerCanary = "private thought";
const diagnosticCanary = "private.thought";
const traceId = "0123456789abcdef0123456789abcdef";
const spanId = "0123456789abcdef";

function assertPrivateStringsRemoved(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.equal(
    serialized.includes(roomCanary),
    false,
    "room canary escaped redaction",
  );
  assert.equal(
    serialized.includes(answerCanary),
    false,
    "answer canary escaped redaction",
  );
  assert.equal(
    serialized.includes(diagnosticCanary),
    false,
    "diagnostic-shaped canary escaped redaction",
  );
}

test("beforeSend allowlists safe error diagnostics and drops every private string surface", () => {
  const event = redactSentryEvent({
    event_id: "abcdefabcdefabcdefabcdefabcdefab",
    timestamp: 1_790_000_000,
    platform: "javascript",
    level: "error",
    message: `player ${roomCanary}: ${answerCanary}`,
    request: {
      method: "POST",
      url: `https://kindred.mistystep.io/?room=${roomCanary}`,
      headers: { cookie: roomCanary },
      data: { answer: answerCanary },
    },
    exception: {
      values: [
        {
          type: "TypeError",
          value: `${roomCanary}: ${answerCanary}`,
          mechanism: {
            type: "generic",
            handled: true,
            data: { original: answerCanary },
          },
          stacktrace: {
            frames: [
              {
                filename: `https://kindred.mistystep.io/_next/static/app.js?room=${roomCanary}`,
                abs_path: `https://kindred.mistystep.io/_next/static/app.js?answer=${answerCanary}`,
                function: "submitAnswer",
                lineno: 42,
                colno: 7,
                in_app: true,
                context_line: answerCanary,
                vars: { room: roomCanary },
              },
            ],
          },
          unknownNested: { note: answerCanary },
        },
      ],
    },
    contexts: {
      trace: {
        trace_id: traceId,
        span_id: spanId,
        op: "http.server",
        origin: diagnosticCanary,
        data: { answer: answerCanary },
        unknownNested: { room: roomCanary },
      },
      device: { name: roomCanary },
    },
    tags: { runtime: "browser", playerName: roomCanary },
    breadcrumbs: [{ message: answerCanary }],
    extra: { answer: answerCanary },
    unknownSurface: { nested: [{ room: roomCanary, answer: answerCanary }] },
  });

  assertPrivateStringsRemoved(event);
  assert.equal("unknownSurface" in event, false);
  assert.equal(event.event_id, "abcdefabcdefabcdefabcdefabcdefab");
  assert.equal(event.platform, "javascript");
  assert.equal(event.level, "error");
  assert.deepEqual(event.request, {
    method: "POST",
    url: "https://kindred.mistystep.io/",
  });
  assert.deepEqual(event.tags, { runtime: "browser" });
  assert.deepEqual(event.contexts, {
    trace: { trace_id: traceId, span_id: spanId, op: "http.server" },
  });
  assert.deepEqual(event.exception, {
    values: [
      {
        type: "TypeError",
        mechanism: { type: "generic", handled: true },
        stacktrace: {
          frames: [
            {
              filename: "https://kindred.mistystep.io/_next/static/app.js",
              abs_path: "https://kindred.mistystep.io/_next/static/app.js",
              function: "submitAnswer",
              lineno: 42,
              colno: 7,
              in_app: true,
            },
          ],
        },
      },
    ],
  });
});

test("beforeSendTransaction keeps trace mechanics but replaces names and removes span payloads", () => {
  const event = redactSentryEvent({
    event_id: "abcdefabcdefabcdefabcdefabcdefab",
    type: "transaction",
    transaction: `/room/${roomCanary}`,
    start_timestamp: 1_790_000_000,
    timestamp: 1_790_000_001,
    contexts: {
      trace: {
        trace_id: traceId,
        span_id: spanId,
        op: "navigation",
        description: answerCanary,
        data: { room: roomCanary },
      },
    },
    spans: [
      {
        trace_id: traceId,
        span_id: "fedcbafedcbafedc",
        parent_span_id: spanId,
        op: "http.client",
        status: "ok",
        origin: "auto.http.nextjs",
        start_timestamp: 1_790_000_000.25,
        timestamp: 1_790_000_000.75,
        description: `GET /?room=${roomCanary}`,
        data: {
          url: `https://kindred.mistystep.io/?room=${roomCanary}`,
          body: { answer: answerCanary },
          unknownNested: [{ secret: answerCanary }],
        },
      },
    ],
    message: `${roomCanary}: ${answerCanary}`,
    unknownSurface: { nested: answerCanary },
  });

  assertPrivateStringsRemoved(event);
  assert.equal("unknownSurface" in event, false);
  assert.equal(event.type, "transaction");
  assert.equal(event.transaction, "kindred.request");
  assert.deepEqual(event.contexts, {
    trace: { trace_id: traceId, span_id: spanId, op: "navigation" },
  });
  assert.deepEqual(event.spans, [
    {
      trace_id: traceId,
      span_id: "fedcbafedcbafedc",
      parent_span_id: spanId,
      op: "http.client",
      status: "ok",
      origin: "auto.http.nextjs",
      start_timestamp: 1_790_000_000.25,
      timestamp: 1_790_000_000.75,
    },
  ]);
});
