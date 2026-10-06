import assert from "node:assert/strict";
import { test } from "node:test";
import { EnvError, loadEnv } from "../server/lib/env";

const valid = {
  DATABASE_URL: "file:./test.db",
  SESSION_SECRET: "s".repeat(40),
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD_HASH: "scrypt:16384:8:1:salt:hash",
};

test("geçerli değişkenlerle yüklenir, varsayılanlar yalnızca gizli olmayanlar için", () => {
  const env = loadEnv(valid);
  assert.equal(env.port, 3000);
  assert.equal(env.nodeEnv, "development");
  assert.equal(env.adminUsername, "admin");
});

test("eksik gizli değerde varsayılan uydurmaz, hata verir", () => {
  assert.throws(() => loadEnv({}), (err: unknown) => {
    assert.ok(err instanceof EnvError);
    assert.ok(err.problems.some((p) => p.includes("SESSION_SECRET")));
    assert.ok(err.problems.some((p) => p.includes("ADMIN_PASSWORD_HASH")));
    return true;
  });
});

test("kısa SESSION_SECRET reddedilir", () => {
  assert.throws(() => loadEnv({ ...valid, SESSION_SECRET: "kisa" }), EnvError);
});

test("biçimi bozuk şifre hash'i reddedilir", () => {
  assert.throws(() => loadEnv({ ...valid, ADMIN_PASSWORD_HASH: "duz-sifre" }), EnvError);
});

test("Meta ayarları yoksa özellik kapalı (null), yarımsa hata", () => {
  assert.equal(loadEnv(valid).meta, null);
  assert.throws(() => loadEnv({ ...valid, META_CATALOG_ID: "123" }), (err: unknown) => {
    assert.ok(err instanceof EnvError);
    assert.ok(err.problems.some((p) => p.includes("META_ACCESS_TOKEN")));
    return true;
  });
});

test("Meta ayarları tam olunca yüklenir, sürüm biçimi doğrulanır", () => {
  const full = { ...valid, META_GRAPH_VERSION: "v23.0", META_CATALOG_ID: "123", META_ACCESS_TOKEN: "t".repeat(20) };
  const env = loadEnv(full);
  assert.equal(env.meta?.catalogId, "123");
  assert.equal(env.meta?.baseUrl, "https://graph.facebook.com");
  assert.throws(() => loadEnv({ ...full, META_GRAPH_VERSION: "23" }), EnvError);
});

test("PUBLIC_BASE_URL: sondaki / atılır, üretimde https zorunlu", () => {
  assert.equal(loadEnv({ ...valid, PUBLIC_BASE_URL: "https://x.example.com/" }).publicBaseUrl, "https://x.example.com");
  assert.throws(() => loadEnv({ ...valid, PUBLIC_BASE_URL: "x.example.com" }), EnvError);
  assert.throws(() => loadEnv({ ...valid, NODE_ENV: "production", PUBLIC_BASE_URL: "http://x.example.com" }), EnvError);
});

test("otomatik eşitleme yalnızca açıkça 'true' ise açılır", () => {
  assert.equal(loadEnv(valid).metaAutoSync, false);
  assert.equal(loadEnv({ ...valid, META_AUTO_SYNC: "true" }).metaAutoSync, true);
  assert.equal(loadEnv({ ...valid, META_AUTO_SYNC: "evet" }).metaAutoSync, false);
});

test("geçersiz PORT reddedilir", () => {
  assert.throws(() => loadEnv({ ...valid, PORT: "abc" }), EnvError);
  assert.throws(() => loadEnv({ ...valid, PORT: "70000" }), EnvError);
});
