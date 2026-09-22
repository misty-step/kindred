"use client";

import { AudioProvider } from "@parlor/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env["NEXT_PUBLIC_CONVEX_URL"];
    return url ? new ConvexReactClient(url) : null;
  });
  if (!client) {
    return (
      <main className="shell">
        <header className="app-header">
          <a className="brand-lockup" href="/" aria-label="Kindred home">
            <img src="/brand/kindred-mark.svg" width="64" height="64" alt="" />
            <span className="wordmark">Kindred</span>
          </a>
        </header>
        <section className="panel status-panel" role="alert">
          <p className="eyebrow">A quiet moment</p>
          <h1>Kindred is resting.</h1>
          <p>
            The rooms are unavailable right now. Try again in a little while.
          </p>
        </section>
      </main>
    );
  }
  return (
    <ConvexProvider client={client}>
      <AudioProvider>{children}</AudioProvider>
    </ConvexProvider>
  );
}
