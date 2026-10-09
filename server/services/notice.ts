import type { Customer, PrismaClient } from "@prisma/client";
import { businessReady, getBusiness } from "./business";

let publicBaseUrl: string | null = null;

/** Sunucu açılışında bir kez çağrılır (aydınlatma bağlantısı için herkese açık adres). */
export function configureNotice(url: string | null): void {
  publicBaseUrl = url;
}

export const policyUrl = () => (publicBaseUrl ? `${publicBaseUrl}/gizlilik` : null);

/**
 * Müşteriye ilk temas mesajına eklenecek aydınlatma satırı ({kvkk} yer tutucusu).
 * Bağlantı daha önce gönderildiyse ya da gizlilik sayfası henüz yayımlanamıyorsa (işletme bilgileri eksik) boş döner.
 */
export async function noticeLine(db: PrismaClient, customer: Pick<Customer, "noticeSentAt">): Promise<string> {
  if (customer.noticeSentAt) return "";
  const url = policyUrl();
  if (!url || !businessReady(await getBusiness(db))) return "";
  return `Kişisel verileriniz sipariş ve iletişim amacıyla işlenir. Aydınlatma metni: ${url}`;
}

/** Aydınlatma satırı gönderildi: bir daha eklenmesin. */
export async function markNoticeSent(db: PrismaClient, customerId: number): Promise<void> {
  await db.customer.updateMany({ where: { id: customerId, noticeSentAt: null }, data: { noticeSentAt: new Date() } });
}
