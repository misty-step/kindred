"use client";

import { AudioProvider } from "@parlor/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";
import { Mark } from "./mark";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env["NEXT_PUBLIC_CONVEX_URL"];
    return url ? new ConvexReactClient(url) : null;
  });
  if (!client) {
    return (
      <main>
        <section className="screen" role="alert" aria-labelledby="resting">
          <Mark className="hero-mark" stroke={1.4} />
          <h1 className="wordmark" id="resting">
            Kindred
          </h1>
          <p className="tagline">
            Rooms are unavailable right now. Try again in a little while.
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
