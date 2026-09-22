import assert from "node:assert/strict";
import test from "node:test";
import {
  parseProductEnvironment,
  parseRelease,
  parseSentryDsn,
} from "../app/runtime-config.ts";

test("product environment is explicit and closed", () => {
  assert.equal(parseProductEnvironment("production"), "production");
  assert.equal(parseProductEnvironment("staging"), "staging");
  assert.equal(parseProductEnvironment("test"), "test");
  assert.throws(
    () => parseProductEnvironment(undefined),
    /PRODUCT_ENVIRONMENT/,
  );
  assert.throws(() => parseProductEnvironment("prod"), /PRODUCT_ENVIRONMENT/);
});

test("release accepts an exact git SHA or a bounded release label", () => {
  assert.equal(
    parseRelease("e9e2cb524c5b816630946d017278351bfbd0ebb6"),
    "e9e2cb524c5b816630946d017278351bfbd0ebb6",
  );
  assert.equal(parseRelease("kindred@2026.09.21"), "kindred@2026.09.21");
  assert.throws(() => parseRelease(undefined), /SENTRY_RELEASE/);
  assert.throws(() => parseRelease("short sha 123"), /SENTRY_RELEASE/);
  assert.throws(() => parseRelease("x".repeat(129)), /SENTRY_RELEASE/);
});

test("Sentry DSN accepts only public HTTPS project DSNs", () => {
  assert.equal(
    parseSentryDsn("https://public-key@errors.example.com/42"),
    "https://public-key@errors.example.com/42",
  );
  assert.equal(parseSentryDsn(undefined), null);
  assert.throws(
    () => parseSentryDsn("http://public-key@errors.example.com/42"),
    /SENTRY_DSN/,
  );
  assert.throws(
    () => parseSentryDsn("https://errors.example.com/42"),
    /SENTRY_DSN/,
  );
  assert.throws(
    () => parseSentryDsn("https://public-key:secret@errors.example.com/42"),
    /SENTRY_DSN/,
  );
});
