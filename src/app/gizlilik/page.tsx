import type { Metadata } from "next";
import { PolicyPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Gizlilik Politikası ve KVKK Aydınlatma Metni | Yerinde",
  robots: { index: true, follow: true },
};

export default function Page() {
  return <PolicyPage />;
}
