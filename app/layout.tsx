import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/libre-franklin";
import "@parlor/react/styles.css";
import "./globals.css";
import { Providers } from "./providers";

const origin =
  process.env["NEXT_PUBLIC_APP_URL"] ?? "https://kindred.mistystep.io";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: "Kindred: say the same thing as exactly one friend",
    template: "%s · Kindred",
  },
  description:
    "A party game for 2 to 12 friends. When exactly two of you say the same thing, you both score.",
  applicationName: "Kindred",
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
    shortcut: "/icon.svg",
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Kindred",
    title: "Kindred",
    description: "When exactly two of you say the same thing, you both score.",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Kindred",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kindred",
    description: "When exactly two of you say the same thing, you both score.",
    images: ["/opengraph-image.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
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
