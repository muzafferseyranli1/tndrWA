import type { Metadata } from "next";
import { DeletionPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Veri Silme Talebi | Yerinde",
  robots: { index: true, follow: true },
};

export default function Page() {
  return <DeletionPage />;
}
