import type { WahaEnv } from "../lib/env";

export type FetchFn = typeof fetch;

export class WahaError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WahaError";
  }
}

export interface WahaSession {
  name: string;
  /** STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED */
  status: string;
  me?: { id?: string; pushName?: string } | null;
}

export const SESSION_EVENTS = ["message.any", "session.status", "engine.event"];

export class WahaClient {
  constructor(
    private readonly cfg: WahaEnv,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async call(path: string, init: { method?: string; json?: unknown; accept?: string } = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.url}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "X-Api-Key": this.cfg.apiKey,
          Accept: init.accept ?? "application/json",
          ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new WahaError("WAHA'ya ulaşılamadı (ağ hatası veya zaman aşımı).");
    }
    return res;
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new WahaError(body.message ?? body.error ?? `WAHA isteği başarısız (HTTP ${res.status}).`, res.status);
    }
    return (await res.json().catch(() => ({}))) as T;
  }

  /** Oturum yoksa null döner. */
  async getSession(name: string): Promise<WahaSession | null> {
    const res = await this.call(`/api/sessions/${encodeURIComponent(name)}`);
    if (res.status === 404) return null;
    return this.json<WahaSession>(res);
  }

  /** Oturumu başlatır; yoksa oluşturur (webhook ayarıyla). */
  async startSession(name: string, webhookUrl: string): Promise<WahaSession> {
    const existing = await this.getSession(name);
    if (existing) {
      if (existing.status === "STOPPED" || existing.status === "FAILED") {
        await this.json(await this.call(`/api/sessions/${encodeURIComponent(name)}/start`, { method: "POST" }));
      }
      return (await this.getSession(name)) ?? existing;
    }
    return this.json<WahaSession>(
      await this.call("/api/sessions", {
        method: "POST",
        json: { name, start: true, config: { webhooks: [{ url: webhookUrl, events: SESSION_EVENTS, hmac: { key: this.cfg.hmacKey } }] } },
      }),
    );
  }

  async stopSession(name: string): Promise<void> {
    await this.json(await this.call(`/api/sessions/${encodeURIComponent(name)}/stop`, { method: "POST" }));
  }

  /** QR kodu PNG olarak; oturum QR beklemiyorsa null. */
  async qr(name: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const res = await this.call(`/api/${encodeURIComponent(name)}/auth/qr`, { accept: "image/png" });
    if (res.status === 404 || res.status === 422) return null;
    if (!res.ok) throw new WahaError(`QR alınamadı (HTTP ${res.status}).`, res.status);
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "image/png" };
  }
}
