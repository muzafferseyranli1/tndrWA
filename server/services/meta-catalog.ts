import { metaPrice } from "../../shared/money";
import type { MetaEnv } from "../lib/env";

export type FetchFn = typeof fetch;

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export interface BatchRequest {
  method: "CREATE" | "UPDATE" | "DELETE";
  data: Record<string, unknown>;
}

export interface BatchItemError {
  id?: string;
  message: string;
}

export interface BatchResult {
  status: string;
  errors: BatchItemError[];
}

export interface ItemSource {
  retailerId: string;
  name: string;
  description: string;
  priceKurus: number;
  imagePath: string | null;
  category: { name: string };
}

export const BRAND = "Yerinde Tandır";

/** Meta ürün verisi. Görsel yoksa null döner (Meta görselsiz ürünü reddeder). */
export function buildItemData(p: ItemSource, inStock: boolean, publicBaseUrl: string): Record<string, unknown> | null {
  if (!p.imagePath) return null;
  return {
    id: p.retailerId,
    title: p.name.slice(0, 200),
    description: (p.description || p.name).slice(0, 9999),
    availability: inStock ? "in stock" : "out of stock",
    condition: "new",
    price: metaPrice(p.priceKurus),
    link: publicBaseUrl,
    image_link: `${publicBaseUrl}/uploads/${p.imagePath}`,
    brand: BRAND,
    product_type: p.category.name,
  };
}

interface CallOptions {
  method?: "GET" | "POST";
  params?: Record<string, string>;
  form?: Record<string, string>;
}

export class MetaCatalogClient {
  constructor(
    private readonly cfg: MetaEnv,
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async call<T>(path: string, { method = "GET", params = {}, form }: CallOptions = {}): Promise<T> {
    const url = new URL(`${this.cfg.baseUrl}/${this.cfg.version}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: form ? new URLSearchParams(form) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new MetaApiError("Meta'ya ulaşılamadı (ağ hatası veya zaman aşımı).");
    }

    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string; code?: number } };
    if (!res.ok) {
      const e = body.error ?? {};
      // Jeton ve istek ayrıntıları mesaja konmaz
      throw new MetaApiError(e.error_user_msg ?? e.message ?? `Meta isteği başarısız (HTTP ${res.status}).`, res.status, e.code);
    }
    return body as T;
  }

  /** items_batch gönderir, işlem tanıtıcısını (handle) döndürür. */
  async submitBatch(requests: BatchRequest[]): Promise<string> {
    const out = await this.call<{ handles?: string[] }>(`${this.cfg.catalogId}/items_batch`, {
      method: "POST",
      form: { item_type: "PRODUCT_ITEM", requests: JSON.stringify(requests) },
    });
    const handle = out.handles?.[0];
    if (!handle) throw new MetaApiError("Meta toplu işlem tanıtıcısı döndürmedi.");
    return handle;
  }

  /** Batch bitene kadar sorgular (işlem asenkron çalışır). */
  async waitForBatch(handle: string, attempts = 20, intervalMs = 2000): Promise<BatchResult> {
    for (let i = 0; i < attempts; i++) {
      await this.sleep(intervalMs);
      const out = await this.call<{
        data?: { status?: string; errors?: { id?: string; message?: string }[]; errors_total_count?: number; ids_of_invalid_requests?: string[] }[];
      }>(`${this.cfg.catalogId}/check_batch_request_status`, { params: { handle, load_ids_of_invalid_requests: "true" } });

      const s = out.data?.[0];
      if (!s?.status || s.status === "in_progress" || s.status === "started") continue;

      const errors: BatchItemError[] = (s.errors ?? []).map((e) => ({ id: e.id, message: e.message ?? "Bilinmeyen hata" }));
      if (!errors.length && (s.errors_total_count ?? 0) > 0) {
        const ids = s.ids_of_invalid_requests ?? [];
        errors.push(...(ids.length ? ids.map((id) => ({ id, message: "Meta bu ürünü reddetti (ayrıntı verilmedi)." })) : [{ message: "Meta bazı ürünleri reddetti (ayrıntı verilmedi)." }]));
      }
      return { status: s.status, errors };
    }
    throw new MetaApiError("Meta toplu işlemi zamanında bitirmedi, biraz sonra tekrar deneyin.");
  }
}
