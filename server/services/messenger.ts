import type { Brand, Customer } from "@prisma/client";
import { CloudApiError, type WhatsappCloudClient } from "./whatsapp-cloud";
import type { TelegramClient } from "./telegram";

/**
 * Müşteriye mesaj gönderme katmanı: sohbet akışı (seçenek, ödeme, adres, durum mesajları) hangi kanaldan geldiğine bakmaz.
 * Alıcı "adres" ikilisiyle verilir: WhatsApp'ta [telefon numarası kimliği, müşteri telefonu], Telegram'da ["tg:<marka kodu>", sohbet kimliği].
 */
export const TG_PREFIX = "tg:";
export type Channel = "whatsapp" | "telegram";
export type Address = [string, string];

export function addrOf(brand: Pick<Brand, "code" | "waPhoneNumberId">, customer: Pick<Customer, "waId" | "tgId">, channel: string): Address | null {
  if (channel === "telegram") return customer.tgId ? [TG_PREFIX + brand.code, customer.tgId] : null;
  return brand.waPhoneNumberId && customer.waId ? [brand.waPhoneNumberId, customer.waId] : null;
}

type Buttons = { id: string; title: string }[];
type ListInput = { body: string; buttonText: string; rows: { id: string; title: string; description?: string }[] };

/** Sohbet akışının kullandığı gönderim yöntemleri (WhatsappCloudClient bunları zaten sağlar; Gateway kanala göre yönlendirir). */
export interface Messenger {
  sendText(to1: string, to2: string, text: string): Promise<string | null>;
  sendButtons(to1: string, to2: string, body: string, buttons: Buttons): Promise<string | null>;
  sendList(to1: string, to2: string, input: ListInput): Promise<string | null>;
  sendCatalog(to1: string, to2: string, text: string, thumbnailRetailerId?: string | null): Promise<string | null>;
  sendProductList(to1: string, to2: string, input: { catalogId: string; header: string; body: string; sections: { title: string; retailerIds: string[] }[] }): Promise<string | null>;
  /** Bu adrese gönderilebilir mi (kanal yapılandırılmış mı)? Yoksa gönderim sessizce atlanır. */
  can?(first: string): boolean;
}

export class Gateway implements Messenger {
  constructor(
    private readonly whatsapp: WhatsappCloudClient | null,
    private readonly telegram: Record<string, TelegramClient> = {},
  ) {}

  /** Telegram botu tanımlı olan marka kodları */
  telegramBrands(): string[] {
    return Object.keys(this.telegram);
  }
  telegramClient(code: string): TelegramClient | null {
    return this.telegram[code] ?? null;
  }

  can(first: string): boolean {
    return first.startsWith(TG_PREFIX) ? !!this.telegram[first.slice(TG_PREFIX.length)] : !!this.whatsapp;
  }

  private tg(first: string): [TelegramClient, string] {
    const code = first.slice(TG_PREFIX.length);
    const client = this.telegram[code];
    if (!client) throw new Error(`${code} için Telegram botu tanımlı değil.`);
    return [client, code];
  }
  private wa(): WhatsappCloudClient {
    if (!this.whatsapp) throw new CloudApiError("WhatsApp gönderim jetonu tanımlı değil.");
    return this.whatsapp;
  }

  async sendText(first: string, to: string, text: string): Promise<string | null> {
    if (!first.startsWith(TG_PREFIX)) return this.wa().sendText(first, to, text);
    const [client, code] = this.tg(first);
    return `${TG_PREFIX}${code}:${await client.sendText(to, text)}`;
  }
  async sendButtons(first: string, to: string, body: string, buttons: Buttons): Promise<string | null> {
    if (!first.startsWith(TG_PREFIX)) return this.wa().sendButtons(first, to, body, buttons);
    const [client, code] = this.tg(first);
    return `${TG_PREFIX}${code}:${await client.sendButtons(to, body, buttons)}`;
  }
  async sendList(first: string, to: string, input: ListInput): Promise<string | null> {
    if (!first.startsWith(TG_PREFIX)) return this.wa().sendList(first, to, input);
    const [client, code] = this.tg(first);
    return `${TG_PREFIX}${code}:${await client.sendList(to, input)}`;
  }
  // Katalog ve ürün listesi yalnız WhatsApp'a özgüdür (Telegram'da menü Mini App'tir)
  async sendCatalog(first: string, to: string, text: string, thumbnailRetailerId?: string | null): Promise<string | null> {
    if (first.startsWith(TG_PREFIX)) throw new Error("Katalog mesajı yalnız WhatsApp'ta gönderilir.");
    return this.wa().sendCatalog(first, to, text, thumbnailRetailerId);
  }
  async sendProductList(first: string, to: string, input: Parameters<WhatsappCloudClient["sendProductList"]>[2]): Promise<string | null> {
    if (first.startsWith(TG_PREFIX)) throw new Error("Ürün listesi yalnız WhatsApp'ta gönderilir.");
    return this.wa().sendProductList(first, to, input);
  }
}
