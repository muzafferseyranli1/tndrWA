/** Rapor hesabı: veritabanından bağımsız saf fonksiyon (test edilebilir). Tutarlar kuruş, gün ve saat İstanbul'a göre. */
export interface ReportOrder {
  createdAt: Date;
  status: string; // NEW | PREPARING | ON_THE_WAY | DELIVERED | CANCELLED
  stage: string; // READY dışındakiler müşteri akışını tamamlamamış sepetlerdir
  totalKurus: number;
  discountKurus: number;
  paymentLabel: string;
  customerId: number;
  items: { name: string; quantity: number; unitKurus: number; extraKurus: number }[];
}

export interface ReportSummary {
  orders: number;
  cancelled: number;
  incomplete: number;
  revenueKurus: number;
  discountKurus: number;
  avgBasketKurus: number;
  customers: number;
  newCustomers: number;
}

export interface ReportData {
  summary: ReportSummary;
  daily: { date: string; orders: number; revenueKurus: number }[];
  hourly: number[];
  payments: { label: string; orders: number; revenueKurus: number }[];
  products: { name: string; quantity: number; revenueKurus: number }[];
}

const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

/** İstanbul'daki takvim günü (YYYY-MM-DD) ve saat. */
export function istanbulParts(d: Date): { date: string; hour: number } {
  const t = new Date(d.getTime() + TZ_OFFSET_MS);
  return { date: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

/** YYYY-MM-DD gününün İstanbul'daki başlangıcı (UTC anı). */
export function istanbulDayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - TZ_OFFSET_MS);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * orders: seçilen aralıktaki tüm siparişler. firstSeen: müşterinin ilk siparişinin tarihi (yeni müşteri ayrımı için), müşteri kimliğine göre.
 * Ciro = iptal edilmeyen ve müşteri akışını tamamlamış siparişlerin (liste toplamı - indirim) toplamı.
 */
export function buildReport(orders: ReportOrder[], from: string, to: string, firstSeen: Map<number, string>): ReportData {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push(d);
  const daily = new Map(days.map((d) => [d, { date: d, orders: 0, revenueKurus: 0 }]));
  const hourly = new Array<number>(24).fill(0);
  const payments = new Map<string, { label: string; orders: number; revenueKurus: number }>();
  const products = new Map<string, { name: string; quantity: number; revenueKurus: number }>();
  const customers = new Set<number>();
  const newCustomers = new Set<number>();
  const summary: ReportSummary = { orders: 0, cancelled: 0, incomplete: 0, revenueKurus: 0, discountKurus: 0, avgBasketKurus: 0, customers: 0, newCustomers: 0 };

  for (const o of orders) {
    if (o.status === "CANCELLED") {
      summary.cancelled++;
      continue;
    }
    if (o.stage !== "READY") {
      summary.incomplete++;
      continue;
    }
    const { date, hour } = istanbulParts(o.createdAt);
    const net = o.totalKurus - o.discountKurus;
    summary.orders++;
    summary.revenueKurus += net;
    summary.discountKurus += o.discountKurus;
    const day = daily.get(date);
    if (day) {
      day.orders++;
      day.revenueKurus += net;
    }
    hourly[hour]++;
    const label = o.paymentLabel || "Belirtilmemiş";
    const p = payments.get(label) ?? { label, orders: 0, revenueKurus: 0 };
    p.orders++;
    p.revenueKurus += net;
    payments.set(label, p);
    for (const i of o.items) {
      const pr = products.get(i.name) ?? { name: i.name, quantity: 0, revenueKurus: 0 };
      pr.quantity += i.quantity;
      pr.revenueKurus += (i.unitKurus + i.extraKurus) * i.quantity;
      products.set(i.name, pr);
    }
    customers.add(o.customerId);
    if ((firstSeen.get(o.customerId) ?? date) >= from) newCustomers.add(o.customerId);
  }
  summary.avgBasketKurus = summary.orders ? Math.round(summary.revenueKurus / summary.orders) : 0;
  summary.customers = customers.size;
  summary.newCustomers = newCustomers.size;
  return {
    summary,
    daily: [...daily.values()],
    hourly,
    payments: [...payments.values()].sort((a, b) => b.revenueKurus - a.revenueKurus),
    products: [...products.values()].sort((a, b) => b.quantity - a.quantity || b.revenueKurus - a.revenueKurus).slice(0, 20),
  };
}
