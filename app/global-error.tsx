"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <main className="shell">
          <section className="panel status-panel" role="alert">
            <p className="eyebrow">The lights flickered</p>
            <h1>Kindred needs a fresh start.</h1>
            <p>Reload the page to return to your room.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload Kindred
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
