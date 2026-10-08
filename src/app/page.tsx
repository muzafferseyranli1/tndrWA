import type { Metadata } from "next";
import BrandPicker from "@/components/BrandPicker";

// Panel sayfaları arama motorlarına kapalı; açılış sayfası herkese açık
export const metadata: Metadata = {
  title: "Yerinde | Sipariş verin",
  description: "Yerinde Tandır ve Yerinde Pide: telefonla, WhatsApp'tan ya da uygulamalardan sipariş verin.",
  robots: { index: true, follow: true },
};

export default function LandingPage() {
  return <BrandPicker />;
}
