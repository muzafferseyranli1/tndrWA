import type { Metadata } from "next";
import RatingForm from "@/components/RatingForm";

export const metadata: Metadata = {
  title: "Yerinde | Bizi değerlendirin",
  robots: { index: false, follow: false },
};

export default async function RatingPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ t?: string }> }) {
  const { code } = await params;
  const { t } = await searchParams;
  return <RatingForm code={code} token={t ?? null} />;
}
