import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/guest/route.ts";

const signingSecret = Buffer.alloc(32, 0x41).toString("base64url");
const continuitySecret = Buffer.alloc(32, 0x42).toString("base64url");

test("isolated local mode serves production builds over loopback HTTP", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "production",
    KINDRED_LOCAL: "true",
    PARLOR_APP_ORIGIN: "http://localhost:3000",
    PARLOR_GUEST_TOKEN_AUDIENCE: "kindred",
    PARLOR_GUEST_TOKEN_KEYS: JSON.stringify({
      activeKeyId: "qa",
      keys: { qa: signingSecret },
    }),
    PARLOR_CONTINUITY_SECRET: continuitySecret,
  });
  try {
    const response = await POST(
      new Request("http://localhost:3000/api/guest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ mode: "acquire" }),
      }),
    );
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /; Secure/i);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
});
