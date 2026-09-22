import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { resolveRuntimeAttribution } from "./app/runtime-config";

const localMode = process.env["KINDRED_LOCAL"] === "true";
let attribution: ReturnType<typeof resolveRuntimeAttribution> | undefined;
try {
  attribution = resolveRuntimeAttribution(process.env);
} catch {
  attribution = undefined;
}

const clientEnvironment: Record<string, string> = {
  NEXT_PUBLIC_KINDRED_LOCAL: localMode ? "true" : "false",
};
if (attribution) {
  clientEnvironment["NEXT_PUBLIC_PRODUCT_ENVIRONMENT"] = attribution.environment;
  clientEnvironment["NEXT_PUBLIC_SENTRY_RELEASE"] = attribution.release;
}

const config: NextConfig = {
  env: clientEnvironment,
  transpilePackages: ["@parlor/core", "@parlor/auth", "@parlor/react", "@parlor/web"],
};

const hasUploadCredentials = Boolean(
  process.env["SENTRY_AUTH_TOKEN"] &&
  process.env["SENTRY_ORG"] &&
  process.env["SENTRY_PROJECT"] &&
  attribution?.release,
);

export default localMode
  ? config
  : withSentryConfig(config, {
      ...(process.env["SENTRY_AUTH_TOKEN"]
        ? { authToken: process.env["SENTRY_AUTH_TOKEN"] }
        : {}),
      ...(process.env["SENTRY_ORG"] ? { org: process.env["SENTRY_ORG"] } : {}),
      project: process.env["SENTRY_PROJECT"] ?? "kindred",
      silent: true,
      telemetry: false,
      widenClientFileUpload: false,
      webpack: {
        treeshake: {
          removeDebugLogging: true,
        },
      },
      sourcemaps: {
        disable: !hasUploadCredentials,
        deleteSourcemapsAfterUpload: true,
      },
      release: attribution
        ? {
            name: attribution.release,
            create: hasUploadCredentials,
            finalize: hasUploadCredentials,
          }
        : { create: false, finalize: false },
    });
