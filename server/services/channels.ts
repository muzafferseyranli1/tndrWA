import type { PrismaClient } from "@prisma/client";
import { CHANNEL_SPECS, channelHref, isChannelKind, type ChannelKind } from "../../shared/channels";
import type { PublicBrandDto } from "../../shared/types";

/** Yeni oluşturulan kanalların ilk değerleri (yalnızca satır ilk açılırken yazılır, sonradan panelden değiştirilir). */
const PREFILL: Record<string, Partial<Record<ChannelKind, string>>> = {
  tandir: {
    YEMEKSEPETI: "https://www.yemeksepeti.com/restaurant/ithr/yerinde-tandir-ithr",
    TRENDYOLGO: "https://tgoyemek.com/restoranlar/479288",
  },
};

/** Her markada, tanımlı tüm kanal türlerinin satırı bulunmasını sağlar (eksikleri kapalı olarak ekler). Tekrar çalıştırmak zararsızdır. */
export async function ensureDefaultChannels(db: PrismaClient): Promise<number> {
  const brands = await db.brand.findMany({ include: { channels: { select: { kind: true } } } });
  let created = 0;
  for (const brand of brands) {
    const have = new Set(brand.channels.map((c) => c.kind));
    for (const [index, spec] of CHANNEL_SPECS.entries()) {
      if (have.has(spec.kind)) continue;
      const value = PREFILL[brand.code]?.[spec.kind] ?? "";
      await db.brandChannel.create({ data: { brandId: brand.id, kind: spec.kind, label: spec.label, value, enabled: value !== "", sortOrder: index } });
      created++;
    }
  }
  return created;
}

/** Herkese açık marka sayfasının verisi: yalnızca açık ve geçerli değeri olan kanallar. */
export async function publicBrand(db: PrismaClient, code: string): Promise<PublicBrandDto | null> {
  const brand = await db.brand.findUnique({ where: { code }, include: { channels: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } });
  if (!brand) return null;
  const channels = brand.channels.flatMap((c) => {
    if (!isChannelKind(c.kind)) return [];
    const href = channelHref(c.kind, c.value);
    return href ? [{ kind: c.kind, label: c.label, href }] : [];
  });
  return { code: brand.code, name: brand.name, channels };
}
