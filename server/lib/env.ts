export interface MetaEnv {
  version: string;
  catalogId: string;
  token: string;
  /** Test için değiştirilebilir; varsayılan resmi Graph API adresi. */
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

  // Meta: üçü birlikte tanımlı olmalı; hiçbiri yoksa özellik kapalıdır.
  const metaKeys = ["META_GRAPH_VERSION", "META_CATALOG_ID", "META_ACCESS_TOKEN"] as const;
  const metaSet = metaKeys.filter((k) => source[k]?.trim());
  let meta: MetaEnv | null = null;
  if (metaSet.length === metaKeys.length) {
    const version = source.META_GRAPH_VERSION!.trim();
    if (!/^v\d+\.\d+$/.test(version)) problems.push("META_GRAPH_VERSION v23.0 gibi olmalı");
    meta = {
      version,
      catalogId: source.META_CATALOG_ID!.trim(),
      token: source.META_ACCESS_TOKEN!.trim(),
      baseUrl: (source.META_GRAPH_BASE_URL?.trim() || "https://graph.facebook.com").replace(/\/+$/, ""),
    };
  } else if (metaSet.length > 0) {
    const missing = metaKeys.filter((k) => !source[k]?.trim());
    problems.push(`Meta ayarları yarım: ${missing.join(", ")} eksik`);
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
  };
}
