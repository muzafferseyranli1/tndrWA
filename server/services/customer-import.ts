import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { normalizePhone } from "../../shared/channels";
import { addressKey } from "./order-flow";

export interface ImportRow {
  line: number;
  name: string | null;
  phone: string | null;
  address: string | null;
}

export interface ImportStats {
  read: number;
  invalidPhone: number;
  duplicateInFile: number;
  created: number;
  existing: number;
  namesFilled: number;
  addressesAdded: number;
  withoutAddress: number;
}

export const emptyStats = (): ImportStats => ({ read: 0, invalidPhone: 0, duplicateInFile: 0, created: 0, existing: 0, namesFilled: 0, addressesAdded: 0, withoutAddress: 0 });

/** Başlık eşleştirme için: küçük harf, Türkçe karakterleri sadeleştir, harf/rakam dışını at. */
export const headerKey = (h: unknown) =>
  String(h ?? "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "");

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
  }
  return String(v).trim();
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** "Mahalle" ve "Adres" sütunlarını tek adres metnine birleştirir (mahalle adres içinde zaten geçiyorsa tekrarlamaz). */
export function joinAddress(neighborhood: string, address: string): string | null {
  const n = squash(neighborhood);
  const a = squash(address);
  if (!a) return null; // yalnızca mahalle bilinen kayıt teslimat için yetersiz
  if (!n || a.toLocaleLowerCase("tr").includes(n.toLocaleLowerCase("tr"))) return a;
  return `${n}, ${a}`;
}

/** Telefon hücresinden (örn. "'+905321234567") normalleştirilmiş numara; geçersizse null. */
export function phoneFromCell(raw: string): string | null {
  return normalizePhone(raw.replace(/^'+/, ""));
}

const NAME_KEYS = ["adsoyad", "ad", "isim", "musteri", "musteriadi", "name"];
const PHONE_KEYS = ["telefon", "tel", "cep", "gsm", "telefon1", "phone"];
const NEIGHBORHOOD_KEYS = ["mahalle"];
const ADDRESS_KEYS = ["adres", "address"];

const MISSING_PHONE = 'Dosyada "Telefon" sütunu bulunamadı. İlk satır sütun başlıklarını içermeli.';

/** Başlık satırından sütunları bulur, sonraki satırları ImportRow'a çevirir. İki okuma yolu da bunu kullanır. */
class RowMapper {
  private cols: { name: number; phone: number; neighborhood: number; address: number } | null = null;
  sawHeader = false;
  problem: string | null = null;

  /** Başlık satırı için null, veri satırı için ImportRow döner. */
  map(values: string[], line: number): ImportRow | null {
    if (!this.cols) {
      this.sawHeader = true;
      const keys = values.map(headerKey);
      const find = (list: string[]) => keys.findIndex((k) => list.includes(k));
      this.cols = { name: find(NAME_KEYS), phone: find(PHONE_KEYS), neighborhood: find(NEIGHBORHOOD_KEYS), address: find(ADDRESS_KEYS) };
      if (this.cols.phone < 0) this.problem = MISSING_PHONE;
      return null;
    }
    if (this.problem) return null; // sütun yok: kalan satırları atla, hatayı sonda bildir
    const get = (i: number) => (i >= 0 ? values[i] ?? "" : "");
    return {
      line,
      name: squash(get(this.cols.name)) || null,
      phone: phoneFromCell(get(this.cols.phone)),
      address: joinAddress(get(this.cols.neighborhood), get(this.cols.address)),
    };
  }
}

class UnreadableError extends Error {}

/** Akışlı okuma (büyük dosyalar için düşük bellek). Kütüphane başlığı göremeden düşerse UnreadableError fırlatır. */
async function* streamRows(buffer: Buffer): AsyncGenerator<ImportRow> {
  const mapper = new RowMapper();
  try {
    const wb = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), { sharedStrings: "cache", worksheets: "emit", styles: "ignore", hyperlinks: "ignore" });
    for await (const ws of wb) {
      let line = 0;
      for await (const row of ws) {
        line++;
        const out = mapper.map((row.values as unknown[]).slice(1).map(cellText), line);
        if (out) yield out;
      }
      break; // yalnızca ilk sayfa
    }
  } catch (err) {
    if (!mapper.sawHeader) throw new UnreadableError((err as Error).message);
    if (!mapper.problem) throw err;
  }
  if (mapper.problem) throw new Error(mapper.problem);
  if (!mapper.sawHeader) throw new UnreadableError("boş");
}

/** Yedek yol: dosyayı tamamen belleğe yükler (yalnızca akışlı okuma başarısız olursa kullanılır). */
async function* loadedRows(buffer: Buffer): AsyncGenerator<ImportRow> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new Error("Excel dosyası okunamadı. Lütfen geçerli bir .xlsx dosyası yükleyin.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel dosyası boş görünüyor.");
  const mapper = new RowMapper();
  for (let r = 1; r <= ws.rowCount; r++) {
    const values = (ws.getRow(r).values as unknown[]).slice(1).map(cellText);
    const out = mapper.map(values, r);
    if (out) yield out;
  }
  if (mapper.problem) throw new Error(mapper.problem);
  if (!mapper.sawHeader) throw new Error("Excel dosyası boş görünüyor.");
}

/** Excel dosyasını (ilk sayfa) satır satır okur. Telefon sütunu yoksa okuma bitince açıklayıcı hata fırlatır. */
export async function* readCustomerRows(buffer: Buffer): AsyncGenerator<ImportRow> {
  try {
    yield* streamRows(buffer);
  } catch (err) {
    if (!(err instanceof UnreadableError)) throw err;
    yield* loadedRows(buffer);
  }
}

const CHUNK = 400;

/**
 * Satırları müşteri olarak içeri alır: telefona göre eşler, olmayanı ekler, olanın boş adını doldurur ve adresini listesine ekler.
 * Var olan kayıtların dolu alanlarının üzerine yazmaz. Her parçada ilerlemeyi bildirir.
 */
export async function importCustomers(db: PrismaClient, rows: AsyncIterable<ImportRow>, onProgress: (s: ImportStats) => void = () => undefined): Promise<ImportStats> {
  const stats = emptyStats();
  const seen = new Set<string>();
  let chunk: (ImportRow & { phone: string })[] = [];

  const flush = async () => {
    if (!chunk.length) return;
    const batch = chunk;
    chunk = [];
    const existing = await db.customer.findMany({ where: { waId: { in: batch.map((r) => r.phone) } }, include: { addresses: { select: { key: true } } } });
    const byPhone = new Map(existing.map((c) => [c.waId!, c]));

    const fresh = batch.filter((r) => !byPhone.has(r.phone));
    if (fresh.length) {
      await db.customer.createMany({ data: fresh.map((r) => ({ waId: r.phone, name: r.name })) });
      stats.created += fresh.length;
    }
    const created = fresh.length ? await db.customer.findMany({ where: { waId: { in: fresh.map((r) => r.phone) } }, select: { id: true, waId: true } }) : [];
    const idByPhone = new Map(created.map((c) => [c.waId!, c.id]));

    const addressRows: { customerId: number; text: string; key: string }[] = [];
    for (const r of batch) {
      const known = byPhone.get(r.phone);
      if (known) {
        stats.existing++;
        if (!known.name && r.name) {
          await db.customer.update({ where: { id: known.id }, data: { name: r.name } });
          stats.namesFilled++;
        }
      }
      const customerId = known?.id ?? idByPhone.get(r.phone);
      if (!customerId) continue;
      if (!r.address) {
        stats.withoutAddress++;
        continue;
      }
      const key = addressKey(r.address);
      if (known?.addresses.some((a) => a.key === key)) continue;
      addressRows.push({ customerId, text: r.address, key });
    }
    if (addressRows.length) {
      await db.customerAddress.createMany({ data: addressRows });
      stats.addressesAdded += addressRows.length;
    }
    onProgress({ ...stats });
  };

  for await (const row of rows) {
    stats.read++;
    if (!row.phone) {
      stats.invalidPhone++;
      continue;
    }
    if (seen.has(row.phone)) {
      stats.duplicateInFile++;
      continue;
    }
    seen.add(row.phone);
    chunk.push({ ...row, phone: row.phone });
    if (chunk.length >= CHUNK) await flush();
  }
  await flush();
  onProgress({ ...stats });
  return stats;
}
