import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import type { PrismaClient } from "@prisma/client";
import { ROBOT_STATUS_KEY, robotRouter, type ImportRunner } from "../server/routes/customers";

const stored = new Map<string, string>();
const db = {
  setting: {
    upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
      stored.set(where.key, create.value);
    },
  },
} as unknown as PrismaClient;

const started: string[] = [];
const runner: ImportRunner = {
  start: (file) => {
    started.push(file.name);
    return { jobId: "abc123" };
  },
  get: (id) => (id === "abc123" ? { id, state: "done", fileName: "x.xlsx", stats: { read: 1, invalidPhone: 0, duplicateInFile: 0, created: 0, existing: 1, namesFilled: 0, addressesAdded: 0, withoutAddress: 0 }, error: null } : null),
};

function serve(token: string | undefined) {
  const app = express();
  app.use("/api/robot", robotRouter(db, runner, token));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("robot ucu", () => {
  let open: ReturnType<typeof serve>;
  let closed: ReturnType<typeof serve>;
  before(() => {
    open = serve("gizli-anahtar");
    closed = serve(undefined);
  });
  after(async () => {
    await open.close();
    await closed.close();
  });

  it("IMPORT_TOKEN yoksa uçlar kapalı (503)", async () => {
    const r = await fetch(`${closed.base}/api/robot/customers/abc123`, { headers: { "x-robot-token": "gizli-anahtar" } });
    assert.equal(r.status, 503);
  });

  it("anahtarsız ve yanlış anahtar reddedilir (401)", async () => {
    assert.equal((await fetch(`${open.base}/api/robot/customers/abc123`)).status, 401);
    assert.equal((await fetch(`${open.base}/api/robot/customers/abc123`, { headers: { "x-robot-token": "yanlis" } })).status, 401);
    assert.equal((await fetch(`${open.base}/api/robot/customers/abc123`, { headers: { "x-robot-token": "gizli-anahtar-uzun" } })).status, 401);
  });

  it("doğru anahtarla iş durumu okunur, bilinmeyen iş 404", async () => {
    const h = { "x-robot-token": "gizli-anahtar" };
    const ok = await fetch(`${open.base}/api/robot/customers/abc123`, { headers: h });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { state: string }).state, "done");
    assert.equal((await fetch(`${open.base}/api/robot/customers/yok`, { headers: h })).status, 404);
  });

  it("Excel yükleme işi başlatır; dosya yoksa 400", async () => {
    const h = { "x-robot-token": "gizli-anahtar" };
    assert.equal((await fetch(`${open.base}/api/robot/customers`, { method: "POST", headers: h })).status, 400);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])]), "m.xlsx");
    const r = await fetch(`${open.base}/api/robot/customers`, { method: "POST", headers: h, body: form });
    assert.equal(r.status, 202);
    assert.equal(((await r.json()) as { jobId: string }).jobId, "abc123");
    assert.deepEqual(started, ["m.xlsx"]);
  });

  it("robot hatasını bildirir; durum ayarlara yazılır", async () => {
    const r = await fetch(`${open.base}/api/robot/report`, { method: "POST", headers: { "x-robot-token": "gizli-anahtar", "content-type": "application/json" }, body: JSON.stringify({ ok: false, message: "giriş yapılamadı" }) });
    assert.equal(r.status, 200);
    const v = JSON.parse(stored.get(ROBOT_STATUS_KEY) ?? "{}") as { ok: boolean; message: string };
    assert.equal(v.ok, false);
    assert.equal(v.message, "giriş yapılamadı");
  });
});
