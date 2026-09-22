export type ProductEnvironment = "production" | "staging" | "test";

const PRODUCT_ENVIRONMENTS = new Set<ProductEnvironment>([
  "production",
  "staging",
  "test",
]);

export function parseProductEnvironment(value: string | undefined): ProductEnvironment {
  if (!value || !PRODUCT_ENVIRONMENTS.has(value as ProductEnvironment)) {
    throw new Error(
      "PRODUCT_ENVIRONMENT must be explicit: production, staging, or test.",
    );
  }
  return value as ProductEnvironment;
}

export function parseRelease(value: string | undefined): string {
  if (
    !value ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._@/+:-]*$/.test(value)
  ) {
    throw new Error(
      "SENTRY_RELEASE must be an exact git SHA or a bounded release label.",
    );
  }
  return value;
}

export function parseSentryDsn(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SENTRY_DSN must be a valid public HTTPS project DSN.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    !url.username ||
    url.password ||
    url.pathname === "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("SENTRY_DSN must be a valid public HTTPS project DSN.");
  }
  return value;
}
