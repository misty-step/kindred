import * as Sentry from "@sentry/nextjs";
import { redactSentryEvent } from "./app/sentry-privacy";
import { resolveSentryOptions } from "./app/sentry-runtime";

Sentry.init({
  ...resolveSentryOptions(process.env, "edge"),
  beforeBreadcrumb: () => null,
  beforeSend: (event) => redactSentryEvent(event),
  beforeSendTransaction: (event) => redactSentryEvent(event),
});
