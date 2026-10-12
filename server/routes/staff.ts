import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient, StaffUser } from "@prisma/client";
import type { StaffUserDto } from "../../shared/types";
import type { Env } from "../lib/env";
import { hashPassword } from "../lib/password";

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, "Kullanıcı adı 3-32 karakter olmalı; yalnızca küçük harf, rakam, nokta, tire ve alt çizgi.");
const password = z.string().min(8, "Şifre en az 8 karakter olmalı.").max(100, "Şifre en fazla 100 karakter olabilir.");
const role = z.enum(["ADMIN", "USER"]);

const toDto = (u: StaffUser): StaffUserDto => ({ id: u.id, username: u.username, role: u.role === "ADMIN" ? "ADMIN" : "USER", active: u.active, createdAt: u.createdAt.toISOString() });

/** Panel: personel hesapları (yalnızca yönetici). Ortamdaki ana yönetici listede salt okunur görünür. */
export function staffRouter(db: PrismaClient, env: Env): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));
  router.use((_req, res, next) => (res.locals.role === "ADMIN" ? next() : void res.status(403).json({ error: "Bu işlem için yönetici olmalısınız." })));

  router.get("/", async (_req, res) => {
    const users = await db.staffUser.findMany({ orderBy: { id: "asc" } });
    res.json({ owner: env.adminUsername, users: users.map(toDto) });
  });

  router.post("/", async (req, res) => {
    const parsed = z.object({ username, password, role }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    if (parsed.data.username === env.adminUsername.trim().toLowerCase()) return res.status(409).json({ error: "Bu kullanıcı adı ana yöneticiye ait." });
    if (await db.staffUser.findUnique({ where: { username: parsed.data.username } })) return res.status(409).json({ error: "Bu kullanıcı adı zaten var." });
    const created = await db.staffUser.create({ data: { username: parsed.data.username, passwordHash: await hashPassword(parsed.data.password), role: parsed.data.role } });
    res.status(201).json(toDto(created));
  });

  router.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ role: role.optional(), active: z.boolean().optional(), password: password.optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    const user = Number.isInteger(id) ? await db.staffUser.findUnique({ where: { id } }) : null;
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    const { role: newRole, active, password: newPassword } = parsed.data;
    const updated = await db.staffUser.update({
      where: { id },
      data: { ...(newRole ? { role: newRole } : {}), ...(active !== undefined ? { active } : {}), ...(newPassword ? { passwordHash: await hashPassword(newPassword) } : {}) },
    });
    res.json(toDto(updated));
  });

  router.delete("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const user = Number.isInteger(id) ? await db.staffUser.findUnique({ where: { id } }) : null;
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    await db.staffUser.delete({ where: { id } });
    res.json({ ok: true });
  });

  return router;
}
