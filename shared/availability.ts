export type ProductStatus = "ACTIVE" | "PASSIVE";
/** HIDDEN: katalogda yok · OUT_OF_STOCK: görünür ama stokta yok · IN_STOCK: sipariş verilebilir */
export type Availability = "IN_STOCK" | "OUT_OF_STOCK" | "HIDDEN";

export interface AvailabilityInput {
  status: ProductStatus;
  soldOutUntil: Date | null;
}

export function availabilityOf(p: AvailabilityInput, now: Date = new Date()): Availability {
  if (p.status === "PASSIVE") return "HIDDEN";
  if (p.soldOutUntil && p.soldOutUntil.getTime() > now.getTime()) return "OUT_OF_STOCK";
  return "IN_STOCK";
}

export const DEFAULT_RESET_HOUR = 5;
// Türkiye kalıcı olarak UTC+3 (yaz saati uygulaması yok).
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "Bugün tükendi"nin sona ereceği an: now'dan sonraki ilk resetHour:00 (Türkiye saati). */
export function nextResetAt(now: Date, resetHour: number = DEFAULT_RESET_HOUR): Date {
  const local = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), resetHour);
  if (target <= local.getTime()) target += 24 * 60 * 60 * 1000;
  return new Date(target - ISTANBUL_OFFSET_MS);
}
