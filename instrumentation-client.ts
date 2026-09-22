import * as Sentry from "@sentry/nextjs";
import { redactSentryEvent } from "./app/sentry-privacy";
import { resolveSentryOptions } from "./app/sentry-runtime";

Sentry.init({
  ...resolveSentryOptions(
    {
      NEXT_PUBLIC_PRODUCT_ENVIRONMENT:
        process.env["NEXT_PUBLIC_PRODUCT_ENVIRONMENT"],
      NEXT_PUBLIC_SENTRY_RELEASE: process.env["NEXT_PUBLIC_SENTRY_RELEASE"],
      NEXT_PUBLIC_KINDRED_LOCAL: process.env["NEXT_PUBLIC_KINDRED_LOCAL"],
      NEXT_PUBLIC_SENTRY_DSN: process.env["NEXT_PUBLIC_SENTRY_DSN"],
    },
    "browser",
  ),
  beforeBreadcrumb: () => null,
  beforeSend: (event) => redactSentryEvent(event),
  beforeSendTransaction: (event) => redactSentryEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
