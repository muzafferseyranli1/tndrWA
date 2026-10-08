import type { Metadata } from "next";
import BrandChannels from "@/components/BrandChannels";

export const metadata: Metadata = {
  title: "Yerinde | Sipariş seçenekleri",
  robots: { index: true, follow: true },
};

export default async function BrandPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <BrandChannels code={code} />;
}
