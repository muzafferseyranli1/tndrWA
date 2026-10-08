import type { WhatsappCloudEnv } from "../lib/env";

export type FetchFn = typeof fetch;

export class CloudApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

// ---------- Webhook ayrıştırma ----------

export interface CloudEventRow {
  /** "cloud:<phone_number_id>" (markanın waPhoneNumberId'si ile eşleşir) */
  session: string;
  event: "cloud.message" | "cloud.status" | string;
  messageType: string | null;
  /** Aynı olayın yeniden gönderimini tek kayıtta tutmak için */
  requestId: string | null;
  body: string;
}

export interface CloudOrderItem {
  retailerId: string;
  quantity: number;
  unitKurus: number;
  currency: string;
}

export interface CloudOrder {
  catalogId: string | null;
  note: string;
  items: CloudOrderItem[];
  totalKurus: number;
}

/** Sipariş mesajı (`type: "order"`): ürün kodları (retailer_id), adetler ve birim fiyatlar webhook'ta hazır gelir. */
export function parseCloudOrder(message: unknown): CloudOrder | null {
  const m = message as { type?: string; order?: { catalog_id?: unknown; text?: unknown; product_items?: unknown } } | null;
  if (!m || m.type !== "order" || !m.order || !Array.isArray(m.order.product_items)) return null;

  const items: CloudOrderItem[] = [];
  for (const raw of m.order.product_items as Record<string, unknown>[]) {
    const retailerId = typeof raw.product_retailer_id === "string" ? raw.product_retailer_id : null;
    const quantity = Number(raw.quantity);
    const price = Number(raw.item_price);
    if (!retailerId || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(price) || price < 0) return null;
    items.push({ retailerId, quantity, unitKurus: Math.round(price * 100), currency: typeof raw.currency === "string" ? raw.currency : "TRY" });
  }
  return {
    catalogId: typeof m.order.catalog_id === "string" ? m.order.catalog_id : null,
    note: typeof m.order.text === "string" ? m.order.text : "",
    items,
    totalKurus: items.reduce((sum, i) => sum + i.unitKurus * i.quantity, 0),
  };
}

/** Meta webhook gövdesini panelde saklanacak olaylara böler (her mesaj ve her durum ayrı kayıt). */
export function extractCloudEvents(payload: unknown): CloudEventRow[] {
  const out: CloudEventRow[] = [];
  const root = payload as { object?: unknown; entry?: unknown } | null;
  if (!root || root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return out;

  for (const entry of root.entry as { id?: string; changes?: unknown }[]) {
    if (!Array.isArray(entry.changes)) continue;
    for (const change of entry.changes as { field?: string; value?: Record<string, unknown> }[]) {
      const value = change.value ?? {};
      const metadata = (value.metadata ?? {}) as { phone_number_id?: string; display_phone_number?: string };
      const session = `cloud:${metadata.phone_number_id ?? "bilinmeyen"}`;
      const base = { wabaId: entry.id ?? null, metadata, contacts: value.contacts ?? null };

      if (change.field === "messages" && Array.isArray(value.messages)) {
        for (const msg of value.messages as { id?: string; type?: string }[]) {
          out.push({
            session,
            event: "cloud.message",
            messageType: typeof msg.type === "string" ? msg.type : null,
            requestId: msg.id ? `cloud:msg:${msg.id}` : null,
            body: JSON.stringify({ ...base, message: msg }),
          });
        }
      }
      if (change.field === "messages" && Array.isArray(value.statuses)) {
        for (const st of value.statuses as { id?: string; status?: string }[]) {
          out.push({
            session,
            event: "cloud.status",
            messageType: typeof st.status === "string" ? `status:${st.status}` : null,
            requestId: st.id && st.status ? `cloud:st:${st.id}:${st.status}` : null,
            body: JSON.stringify({ ...base, status: st }),
          });
        }
      }
      if (change.field !== "messages") {
        out.push({ session, event: `cloud.${change.field ?? "bilinmeyen"}`, messageType: null, requestId: null, body: JSON.stringify({ ...base, change }) });
      }
    }
  }
  return out;
}

// ---------- Mesaj gönderme / numara bilgisi ----------

export interface PhoneInfo {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  platformType: string | null;
}

export class WhatsappCloudClient {
  constructor(
    private readonly cfg: WhatsappCloudEnv,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async call<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
    if (!this.cfg.token) throw new CloudApiError("WHATSAPP_CLOUD_TOKEN tanımlı değil.");
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.baseUrl}/${this.cfg.version}/${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${this.cfg.token}`, ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new CloudApiError("WhatsApp Cloud API'ye ulaşılamadı (ağ hatası veya zaman aşımı).");
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string; code?: number } } & T;
    if (!res.ok) {
      const e = body.error ?? {};
      throw new CloudApiError(e.error_user_msg ?? e.message ?? `WhatsApp isteği başarısız (HTTP ${res.status}).`, res.status, e.code);
    }
    return body as T;
  }

  /** Serbest metin gönderir (yalnızca müşterinin son mesajından sonraki 24 saat içinde geçerli). Mesaj kimliğini döndürür. */
  async sendText(phoneNumberId: string, to: string, text: string): Promise<string | null> {
    const out = await this.call<{ messages?: { id?: string }[] }>(`${phoneNumberId}/messages`, {
      method: "POST",
      json: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } },
    });
    return out.messages?.[0]?.id ?? null;
  }

  /** Numaraya bağlı kataloğu açan düğmeli mesaj (müşteri katalogdan sepet kurup sipariş verir). */
  async sendCatalog(phoneNumberId: string, to: string, text: string): Promise<string | null> {
    const out = await this.call<{ messages?: { id?: string }[] }>(`${phoneNumberId}/messages`, {
      method: "POST",
      json: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive", interactive: { type: "catalog_message", body: { text }, action: { name: "catalog_message" } } },
    });
    return out.messages?.[0]?.id ?? null;
  }

  /** Seçim listesi (en fazla 10 satır). Müşterinin seçimi webhook'ta `interactive.list_reply.id` olarak gelir. */
  async sendList(phoneNumberId: string, to: string, input: { body: string; buttonText: string; rows: { id: string; title: string; description?: string }[] }): Promise<string | null> {
    const out = await this.call<{ messages?: { id?: string }[] }>(`${phoneNumberId}/messages`, {
      method: "POST",
      json: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: input.body },
          action: { button: input.buttonText.slice(0, 20), sections: [{ title: "Seçenekler", rows: input.rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }] },
        },
      },
    });
    return out.messages?.[0]?.id ?? null;
  }

  /** En fazla 3 hızlı yanıt düğmesi. Seçim webhook'ta `interactive.button_reply.id` olarak gelir. */
  async sendButtons(phoneNumberId: string, to: string, body: string, buttons: { id: string; title: string }[]): Promise<string | null> {
    const out = await this.call<{ messages?: { id?: string }[] }>(`${phoneNumberId}/messages`, {
      method: "POST",
      json: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: { type: "button", body: { text: body }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } },
      },
    });
    return out.messages?.[0]?.id ?? null;
  }

  /** Numaranın görünen adı ve durumu: jetonun geçerli olduğunu da doğrular. */
  async phoneInfo(phoneNumberId: string): Promise<PhoneInfo> {
    const out = await this.call<{ display_phone_number?: string; verified_name?: string; quality_rating?: string; platform_type?: string }>(
      `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,platform_type`,
    );
    return {
      displayPhoneNumber: out.display_phone_number ?? null,
      verifiedName: out.verified_name ?? null,
      qualityRating: out.quality_rating ?? null,
      platformType: out.platform_type ?? null,
    };
  }
}
