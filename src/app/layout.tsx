import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Databuddy } from "@databuddy/sdk/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "gpu-terminal — GPU Cloud Price Monitor",
  description:
    "Compare source-backed GPU hourly prices across clouds and decentralized marketplaces. Filter by hardware, memory, region, billing model and minimum spend.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Databuddy
          clientId={process.env.NEXT_PUBLIC_DATABUDDY_CLIENT_ID}
          trackWebVitals
          trackErrors
          trackOutgoingLinks
          debug={process.env.NODE_ENV === "development"}
        />
      </body>
    </html>
  );
}
