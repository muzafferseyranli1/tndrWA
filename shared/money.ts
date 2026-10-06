/** Para birimi yardımcıları. Tutarlar kuruş (tam sayı) olarak tutulur. */

/** "1.099,00", "949", "949,5", "1099.00", "₺375" gibi girdileri kuruşa çevirir; geçersizse null. */
export function parsePriceToKurus(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  let s = input.replace(/\s|TL|TRY|₺/gi, "");
  if (!s) return null;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.099" -> 1099
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** 109900 -> "1.099,00 TL" */
export function formatTRY(kurus: number): string {
  const sign = kurus < 0 ? "-" : "";
  const abs = Math.abs(kurus);
  const lira = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const kr = (abs % 100).toString().padStart(2, "0");
  return `${sign}${lira},${kr} TL`;
}

/** Meta fiyat biçimi: 109900 -> "1099.00 TRY" */
export function metaPrice(kurus: number): string {
  return `${Math.floor(kurus / 100)}.${(kurus % 100).toString().padStart(2, "0")} TRY`;
}

/** Yüzde indirimi kuruşa yuvarlayarak uygular (indirim tutarını döndürür). */
export function percentOf(kurus: number, percent: number): number {
  return Math.round((kurus * percent) / 100);
}

/**
 * Porsiyon çarpanıyla fiyat (örn. 1,5 porsiyon): fiyat x çarpan, en yakın TAM LİRAYA yuvarlanır (yarım yukarı).
 * 632,50 x 1,5 = 948,75 -> 949 TL; 863 x 1,5 = 1294,50 -> 1295 TL.
 */
export function portionPrice(kurus: number, factor: number): number {
  return Math.round((kurus * factor) / 100) * 100;
}
