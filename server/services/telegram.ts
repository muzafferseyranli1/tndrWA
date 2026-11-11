import { createHash } from "node:crypto";

/** Telegram Bot API hatası (jeton ya da sohbet geçersiz, kullanıcı botu engellemiş vb.) */
export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

type FetchFn = typeof fetch;

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}
export interface ReplyButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
}
export type ReplyMarkup = { inline_keyboard: InlineButton[][] } | { keyboard: ReplyButton[][]; resize_keyboard?: boolean; one_time_keyboard?: boolean } | { remove_keyboard: true };

export interface TelegramBotInfo {
  id: number;
  username: string;
  first_name: string;
}

/** callback_data en fazla 64 bayt olabilir; akıştaki kimlikler ("opt:12:34:5:6") buna sığar, sığmazsa gönderim öncesi yakalanır. */
export const CALLBACK_MAX_BYTES = 64;

/** Bağlantı kurulamayan (isteğin Telegram'a hiç ulaşmadığı) hatalar: yeniden denemek güvenli */
const CONNECT_ERRORS = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ENOTFOUND"]);

/** Webhook'u doğrulayan gizli anahtar: jetondan türetilir (ayrı bir ortam değişkeni gerekmez), jeton gizli olduğu için tahmin edilemez. */
export const webhookSecret = (token: string): string => createHash("sha256").update(`${token}:yrndwa-telegram-webhook`).digest("hex").slice(0, 48);

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly apiBase = "https://api.telegram.org",
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    let res: Response | null = null;
    for (let attempt = 1; !res; attempt++) {
      try {
        res = await this.fetchFn(`${this.apiBase}/bot${this.token}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        const cause = (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error)?.name ?? "bilinmiyor";
        if (attempt < 3 && CONNECT_ERRORS.has(cause)) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw new TelegramApiError(`Telegram'a ulaşılamadı (ağ hatası veya zaman aşımı: ${cause}).`);
      }
    }
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
    if (!res.ok || !body.ok) throw new TelegramApiError(body.description ?? `Telegram isteği başarısız (HTTP ${res.status}).`, body.error_code ?? res.status);
    return body.result as T;
  }

  getMe(): Promise<TelegramBotInfo> {
    return this.call("getMe");
  }
  getWebhookInfo(): Promise<{ url: string; pending_update_count: number; last_error_message?: string }> {
    return this.call("getWebhookInfo");
  }
  /** Telegram'ın güncellemeleri göndereceği adres; gizli anahtar her istekte X-Telegram-Bot-Api-Secret-Token başlığıyla gelir. */
  setWebhook(url: string): Promise<true> {
    return this.call("setWebhook", { url, secret_token: webhookSecret(this.token), allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
  }
  setMyCommands(commands: { command: string; description: string }[]): Promise<true> {
    return this.call("setMyCommands", { commands });
  }
  setMyDescription(description: string): Promise<true> {
    return this.call("setMyDescription", { description });
  }
  setMyShortDescription(shortDescription: string): Promise<true> {
    return this.call("setMyShortDescription", { short_description: shortDescription });
  }
  /** Sohbet kutusunun yanındaki menü düğmesi: Mini App'i açar (adres HTTPS olmalı). */
  setChatMenuButton(button: { type: "web_app"; text: string; web_app: { url: string } } | { type: "default" }): Promise<true> {
    return this.call("setChatMenuButton", { menu_button: button });
  }

  async sendMessage(chatId: string | number, text: string, markup?: ReplyMarkup): Promise<number> {
    const out = await this.call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, ...(markup ? { reply_markup: markup } : {}) });
    return out.message_id;
  }
  answerCallbackQuery(id: string, text?: string): Promise<true> {
    return this.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  }

  // ---- WhatsApp istemcisiyle aynı biçimde (sohbet akışı kanala bakmadan çağırabilsin diye): kimlik "<sohbet>:<mesaj>" döner ----
  async sendText(chatId: string, text: string): Promise<string> {
    return `${chatId}:${await this.sendMessage(chatId, text)}`;
  }
  /** Düğmeler (en fazla 3): sohbetin altında tek satırda dizilen satır içi düğmeler */
  async sendButtons(chatId: string, body: string, buttons: { id: string; title: string }[]): Promise<string> {
    return `${chatId}:${await this.sendMessage(chatId, body, { inline_keyboard: buttons.map((b) => [inlineButton(b.title, b.id)]) })}`;
  }
  /** Liste: her satır bir düğme (altına açıklaması da eklenir) */
  async sendList(chatId: string, input: { body: string; rows: { id: string; title: string; description?: string }[] }): Promise<string> {
    const keyboard = input.rows.map((r) => [inlineButton(r.description ? `${r.title} · ${r.description}` : r.title, r.id)]);
    return `${chatId}:${await this.sendMessage(chatId, input.body, { inline_keyboard: keyboard })}`;
  }
}

function inlineButton(text: string, id: string): InlineButton {
  if (Buffer.byteLength(id, "utf8") > CALLBACK_MAX_BYTES) throw new TelegramApiError(`Düğme kimliği ${CALLBACK_MAX_BYTES} bayttan uzun: ${id}`);
  return { text: text.slice(0, 64), callback_data: id };
}
