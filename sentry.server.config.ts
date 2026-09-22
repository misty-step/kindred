import * as Sentry from "@sentry/nextjs";
import { redactSentryEvent } from "./app/sentry-privacy";
import { resolveSentryOptions } from "./app/sentry-runtime";

Sentry.init({
  ...resolveSentryOptions(process.env, "server"),
  beforeBreadcrumb: () => null,
  beforeSend: (event) => redactSentryEvent(event),
  beforeSendTransaction: (event) => redactSentryEvent(event),
});
