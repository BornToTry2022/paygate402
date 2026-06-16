import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayGate402 — agent-payable APIs on Arc",
  description:
    "Turn any API route into an x402-paywalled, agent-payable, sub-cent USDC storefront on Circle Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
