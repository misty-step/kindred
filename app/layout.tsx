import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";
import "@parlor/react/styles.css";
import "./globals.css";
import { Providers } from "./providers";

const origin =
  process.env["NEXT_PUBLIC_APP_URL"] ?? "https://kindred.mistystep.io";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: "Kindred · Find the same thought",
    template: "%s · Kindred",
  },
  description:
    "A secret-answer party game about the small spark of thinking alike.",
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
    title: "Kindred · Find the same thought",
    description: "Answer in secret. Discover who thought like you.",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Kindred fireflies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kindred · Find the same thought",
    description: "Answer in secret. Discover who thought like you.",
    images: ["/opengraph-image.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b1026",
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
