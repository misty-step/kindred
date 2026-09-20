import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@parlor/react/styles.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Kindred · Same Brain",
  description:
    "A shared-thought party game. One secret answer each, then find out who was thinking the same thing.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}