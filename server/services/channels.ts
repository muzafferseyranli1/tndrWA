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
  const brands = await db.brand.findMany({ include: { channels: { select: { kind: true, sortOrder: true } } } });
  let created = 0;
  for (const brand of brands) {
    const have = new Set(brand.channels.map((c) => c.kind));
    // Sonradan eklenen kanal türleri mevcut sıranın SONUNA konur (panelden ▲▼ ile taşınır); yeni markalar varsayılan sırayla başlar
    let next = brand.channels.length ? Math.max(...brand.channels.map((c) => c.sortOrder)) + 1 : 0;
    for (const [index, spec] of CHANNEL_SPECS.entries()) {
      if (have.has(spec.kind)) continue;
      const value = PREFILL[brand.code]?.[spec.kind] ?? "";
      const sortOrder = brand.channels.length ? next++ : index;
      await db.brandChannel.create({ data: { brandId: brand.id, kind: spec.kind, label: spec.label, value, enabled: value !== "" || spec.kind === "REVIEW", sortOrder } });
      created++;
    }
  }
  return created;
}

/** Herkese açık marka sayfasının verisi: yalnızca açık ve geçerli değeri olan kanallar. */
export async function publicBrand(db: PrismaClient, code: string): Promise<PublicBrandDto | null> {
  const brand = await db.brand.findUnique({ where: { code }, include: { channels: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } });
  if (!brand) return null;
  const channels = brand.channels.flatMap((c): PublicBrandDto["channels"] => {
    if (!isChannelKind(c.kind)) return [];
    // "Bizi değerlendirin" her zaman dahili değerlendirme sayfasına gider; kanalın değeri (Google yorum bağlantısı) o sayfada gösterilir
    const href = c.kind === "REVIEW" ? `/m/${brand.code}/degerlendir` : channelHref(c.kind, c.value);
    if (href) return [{ kind: c.kind, label: c.label, href }];
    // Telegram: bağlantı henüz yoksa pasif "Çok yakında" düğmesi (bağlantı girilmiş ama geçersizse hiç gösterilmez)
    return c.kind === "TELEGRAM" && !c.value.trim() ? [{ kind: c.kind, label: c.label, href: null, soon: true }] : [];
  });
  return { code: brand.code, name: brand.name, channels };
}
