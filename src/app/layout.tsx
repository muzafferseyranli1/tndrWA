import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tndrWA Panel",
  description: "WhatsApp katalog ve sipariş yönetimi",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
