export interface MetaEnv {
  version: string;
  /** Ortak jeton. Markaya özel jeton gerekirse META_ACCESS_TOKEN_<KOD> (örn. META_ACCESS_TOKEN_PIDE). */
  token: string;
  /** Marka kodu (küçük harf) -> o markaya özel jeton */
  brandTokens: Record<string, string>;
  /** Yalnızca ilk kurulumda varsayılan markanın katalog kimliğini doldurmak için (sonra veritabanından okunur). */
  defaultCatalogId: string | null;
  /** Test için değiştirilebilir; varsayılan resmi Graph API adresi. */
  baseUrl: string;
}

export interface WahaEnv {
  /** WAHA adresi, örn. https://waha-tndrwa.derinsoft.com.tr */
  url: string;
  apiKey: string;
  /** Webhook imzası için ortak gizli anahtar (WAHA'daki WHATSAPP_HOOK_HMAC_KEY ile aynı) */
  hmacKey: string;
}

export interface WhatsappCloudEnv {
  /** Meta uygulama sırrı: webhook imzası (X-Hub-Signature-256) bununla doğrulanır */
  appSecret: string;
  /** Meta'da webhook adresi tanımlanırken girilen doğrulama anahtarı */
  verifyToken: string;
  /** Sistem kullanıcısı jetonu (mesaj göndermek için); henüz yoksa null */
  token: string | null;
  version: string;
  baseUrl: string;
}

export interface Env {
  nodeEnv: "development" | "production" | "test";
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  adminUsername: string;
  adminPasswordHash: string;
  /** Yüklenen ürün görsellerinin klasörü (üretimde kalıcı volume içinde olmalı). */
  uploadDir: string;
  /** Meta'nın görselleri çekeceği herkese açık HTTPS adres, örn. https://tndrwa.derinsoft.com.tr */
  publicBaseUrl: string | null;
  /** Meta ayarları eksikse null: panel çalışır, eşitleme açık hata verir. */
  meta: MetaEnv | null;
  /** true ise panelde yapılan değişiklikler birkaç saniye içinde otomatik Meta'ya gider. */
  metaAutoSync: boolean;
  /** WAHA ayarları eksikse null: panel çalışır, WhatsApp sayfası "ayar eksik" der, webhook kabul edilmez. */
  waha: WahaEnv | null;
  /** Resmi WhatsApp Cloud API ayarları eksikse null: webhook kabul edilmez, panel "ayar eksik" der. */
  whatsappCloud: WhatsappCloudEnv | null;
}

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Ortam değişkenleri eksik veya hatalı:\n - ${problems.join("\n - ")}`);
    this.name = "EnvError";
  }
}

type Source = Record<string, string | undefined>;

/** Eksik/hatalı değişkende varsayılan değer UYDURMADAN hata verir. */
export function loadEnv(source: Source = process.env): Env {
  const problems: string[] = [];
  const need = (key: string): string => {
    const value = source[key]?.trim();
    if (!value) problems.push(`${key} tanımlı değil`);
    return value ?? "";
  };

  const databaseUrl = need("DATABASE_URL");
  const sessionSecret = need("SESSION_SECRET");
  const adminUsername = need("ADMIN_USERNAME");
  const adminPasswordHash = need("ADMIN_PASSWORD_HASH");

  if (sessionSecret && sessionSecret.length < 32) {
    problems.push("SESSION_SECRET en az 32 karakter olmalı (npm run admin:password üretir)");
  }
  if (adminPasswordHash && !adminPasswordHash.startsWith("scrypt:")) {
    problems.push("ADMIN_PASSWORD_HASH biçimi geçersiz (npm run admin:password ile üretin)");
  }

  const portRaw = source.PORT?.trim() || "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("PORT geçersiz");

  const nodeEnvRaw = source.NODE_ENV?.trim() || "development";
  if (!["development", "production", "test"].includes(nodeEnvRaw)) problems.push("NODE_ENV geçersiz");

  // Meta: sürüm ve jeton birlikte tanımlı olmalı; hiçbiri yoksa özellik kapalıdır.
  // Katalog kimliği artık markaya bağlı (veritabanında); META_CATALOG_ID yalnızca varsayılan marka için ilk doldurmada kullanılır.
  const metaKeys = ["META_GRAPH_VERSION", "META_ACCESS_TOKEN"] as const;
  const metaSet = metaKeys.filter((k) => source[k]?.trim());
  let meta: MetaEnv | null = null;
  if (metaSet.length === metaKeys.length) {
    const version = source.META_GRAPH_VERSION!.trim();
    if (!/^v\d+\.\d+$/.test(version)) problems.push("META_GRAPH_VERSION v23.0 gibi olmalı");
    const brandTokens: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) {
      const m = /^META_ACCESS_TOKEN_([A-Z0-9_]+)$/.exec(key);
      if (m && value?.trim()) brandTokens[m[1].toLowerCase()] = value.trim();
    }
    meta = {
      version,
      token: source.META_ACCESS_TOKEN!.trim(),
      brandTokens,
      defaultCatalogId: source.META_CATALOG_ID?.trim() || null,
      baseUrl: (source.META_GRAPH_BASE_URL?.trim() || "https://graph.facebook.com").replace(/\/+$/, ""),
    };
  } else if (metaSet.length > 0) {
    const missing = metaKeys.filter((k) => !source[k]?.trim());
    problems.push(`Meta ayarları yarım: ${missing.join(", ")} eksik`);
  }

  // WAHA: adres, API anahtarı ve webhook anahtarı birlikte tanımlı olmalı; hiçbiri yoksa özellik kapalıdır.
  const wahaKeys = ["WAHA_URL", "WAHA_API_KEY", "WAHA_WEBHOOK_HMAC_KEY"] as const;
  const wahaSet = wahaKeys.filter((k) => source[k]?.trim());
  let waha: WahaEnv | null = null;
  if (wahaSet.length === wahaKeys.length) {
    const url = source.WAHA_URL!.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s/]+/.test(url)) problems.push("WAHA_URL http(s):// ile başlamalı");
    waha = { url, apiKey: source.WAHA_API_KEY!.trim(), hmacKey: source.WAHA_WEBHOOK_HMAC_KEY!.trim() };
  } else if (wahaSet.length > 0) {
    problems.push(`WAHA ayarları yarım: ${wahaKeys.filter((k) => !source[k]?.trim()).join(", ")} eksik`);
  }

  // Resmi WhatsApp Cloud API: uygulama sırrı ve doğrulama anahtarı birlikte olmalı; jeton sonra eklenebilir.
  const cloudKeys = ["META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"] as const;
  const cloudSet = cloudKeys.filter((k) => source[k]?.trim());
  let whatsappCloud: WhatsappCloudEnv | null = null;
  if (cloudSet.length === cloudKeys.length) {
    if (!meta) problems.push("WhatsApp Cloud API için META_GRAPH_VERSION ve META_ACCESS_TOKEN da tanımlı olmalı");
    whatsappCloud = {
      appSecret: source.META_APP_SECRET!.trim(),
      verifyToken: source.WHATSAPP_VERIFY_TOKEN!.trim(),
      token: source.WHATSAPP_CLOUD_TOKEN?.trim() || null,
      version: meta?.version ?? "",
      baseUrl: meta?.baseUrl ?? "https://graph.facebook.com",
    };
  } else if (cloudSet.length > 0) {
    problems.push(`WhatsApp Cloud API ayarları yarım: ${cloudKeys.filter((k) => !source[k]?.trim()).join(", ")} eksik`);
  }

  const publicRaw = source.PUBLIC_BASE_URL?.trim();
  let publicBaseUrl: string | null = null;
  if (publicRaw) {
    if (!/^https?:\/\/[^\s/]+/.test(publicRaw)) problems.push("PUBLIC_BASE_URL http(s):// ile başlamalı");
    publicBaseUrl = publicRaw.replace(/\/+$/, "");
  }
  if (nodeEnvRaw === "production" && publicBaseUrl && !publicBaseUrl.startsWith("https://")) {
    problems.push("Üretimde PUBLIC_BASE_URL https:// olmalı (Meta HTTPS görsel ister)");
  }

  if (problems.length) throw new EnvError(problems);

  return {
    nodeEnv: nodeEnvRaw as Env["nodeEnv"],
    port,
    databaseUrl,
    sessionSecret,
    adminUsername,
    adminPasswordHash,
    uploadDir: source.UPLOAD_DIR?.trim() || "./uploads",
    publicBaseUrl,
    meta,
    metaAutoSync: source.META_AUTO_SYNC?.trim().toLowerCase() === "true",
    waha,
    whatsappCloud,
  };
}
