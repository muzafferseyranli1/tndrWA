import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKUP_NAME, backupDue, stamp, type BackupFile } from "../server/services/backup";

const file = (name: string, kind: "db" | "uploads" = "db"): BackupFile => ({ name, kind, sizeBytes: 1, createdAt: new Date().toISOString() });

test("zaman damgası Türkiye saatiyle (UTC+3)", () => {
  assert.equal(stamp(new Date("2026-10-09T01:05:00Z")), "20261009-0405");
  assert.equal(stamp(new Date("2026-10-08T21:30:00Z")), "20261009-0030"); // gece yarısını geçti
});

test("yedek adı doğrulama: geçerli adlar, yol gezme ve yabancı dosyalar reddedilir", () => {
  assert.ok(BACKUP_NAME.test("tndrwa-db-20261009-0405.db.gz"));
  assert.ok(BACKUP_NAME.test("tndrwa-uploads-20261009-0405.tar.gz"));
  for (const bad of ["../etc/passwd", "tndrwa-db-20261009-0405.db", "tndrwa-db-20261009-0405.db.gz/../x", "x.tar.gz", "tndrwa-db-2026-0405.db.gz", "/tndrwa-db-20261009-0405.db.gz"]) {
    assert.equal(BACKUP_NAME.test(bad), false, bad);
  }
});

test("günlük yedek zamanı: 04:00'ten önce yok, sonra bugünün yedeği yoksa var", () => {
  const files = [file("tndrwa-db-20261008-0405.db.gz")];
  assert.equal(backupDue(files, new Date("2026-10-09T00:30:00Z")), false); // 03:30 Türkiye
  assert.equal(backupDue(files, new Date("2026-10-09T01:30:00Z")), true); // 04:30 Türkiye, bugünün yedeği yok
  assert.equal(backupDue([...files, file("tndrwa-db-20261009-0405.db.gz")], new Date("2026-10-09T10:00:00Z")), false); // bugünkü var
  assert.equal(backupDue([file("tndrwa-uploads-20261009-0405.tar.gz", "uploads")], new Date("2026-10-09T10:00:00Z")), true); // yalnızca görsel yedeği DB sayılmaz
  assert.equal(backupDue([], new Date("2026-10-09T10:00:00Z")), true);
});
