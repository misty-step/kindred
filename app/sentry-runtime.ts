import { parseSentryDsn, resolveRuntimeAttribution } from "./runtime-config.ts";

type SentryRuntime = "browser" | "edge" | "server";
type Environment = Record<string, string | undefined>;

function runtimeEnvironment(environment: Environment, runtime: SentryRuntime): Environment {
  if (runtime !== "browser") return environment;
  return {
    PRODUCT_ENVIRONMENT: environment["NEXT_PUBLIC_PRODUCT_ENVIRONMENT"],
    SENTRY_RELEASE: environment["NEXT_PUBLIC_SENTRY_RELEASE"],
    KINDRED_LOCAL: environment["NEXT_PUBLIC_KINDRED_LOCAL"],
  };
}

export function resolveSentryOptions(environment: Environment, runtime: SentryRuntime) {
  let attribution: ReturnType<typeof resolveRuntimeAttribution> | undefined;
  let dsn: string | null = null;
  try {
    attribution = resolveRuntimeAttribution(runtimeEnvironment(environment, runtime));
    dsn = parseSentryDsn(
      runtime === "browser"
        ? environment["NEXT_PUBLIC_SENTRY_DSN"]
        : (environment["SENTRY_DSN"] ?? environment["NEXT_PUBLIC_SENTRY_DSN"]),
    );
  } catch {
    attribution = undefined;
    dsn = null;
  }
  const local =
    runtime === "browser"
      ? environment["NEXT_PUBLIC_KINDRED_LOCAL"] === "true"
      : environment["KINDRED_LOCAL"] === "true";
  const enabled = dsn !== null && attribution !== undefined && !local;
  return {
    dsn: dsn ?? undefined,
    enabled,
    environment: attribution?.environment,
    release: attribution?.release,
    sendDefaultPii: false as const,
    tracesSampleRate: enabled ? 0.05 : 0,
  };
}
