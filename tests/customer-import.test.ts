import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { headerKey, joinAddress, phoneFromCell, readCustomerRows } from "../server/services/customer-import";

test("başlık eşleştirme: Türkçe karakter ve boşluk farkı", () => {
  assert.equal(headerKey("Ad Soyad"), "adsoyad");
  assert.equal(headerKey("  Telefon "), "telefon");
  assert.equal(headerKey("ADRES"), "adres");
  assert.equal(headerKey("Şubeler"), "subeler");
});

test("Excel'deki telefon hücresi (başında kesme işaretiyle) normalleştirilir", () => {
  assert.equal(phoneFromCell("'+905331234567"), "905331234567");
  assert.equal(phoneFromCell("0533 123 45 67"), "905331234567");
  assert.equal(phoneFromCell("'+90533123456"), null);
  assert.equal(phoneFromCell(""), null);
  assert.equal(phoneFromCell("'+99"), null);
});

test("adres birleştirme: mahalle tekrarlanmaz, adresi olmayan kayıt null", () => {
  assert.equal(joinAddress("Suadiye Mah.", "Bağdat Cad. No:5"), "Suadiye Mah., Bağdat Cad. No:5");
  assert.equal(joinAddress("Suadiye", "Suadiye Mah. Bağdat Cad. No:5"), "Suadiye Mah. Bağdat Cad. No:5");
  assert.equal(joinAddress("Suadiye", ""), null);
  assert.equal(joinAddress("", "  Bağdat   Cad.  No:5 "), "Bağdat Cad. No:5");
});

test("xlsx okuma: sütun sırası fark etmez, bozuk satırlar telefonsuz gelir, başlıksız dosya hata verir", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Müşteriler");
  ws.addRow(["Adres", "Ad Soyad", "Mahalle", "Telefon", "Email"]);
  ws.addRow(["Bağdat Cad. No:5", " Ali  Veli ", "Suadiye", "'+905331234567", ""]);
  ws.addRow(["", "Ayşe", "Moda", "123", ""]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const rows = [];
  for await (const r of readCustomerRows(buffer)) rows.push(r);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { line: 2, name: "Ali Veli", phone: "905331234567", address: "Suadiye, Bağdat Cad. No:5" });
  assert.equal(rows[1].phone, null);
  assert.equal(rows[1].address, null);

  const bad = new ExcelJS.Workbook();
  bad.addWorksheet("x").addRow(["Ad", "Not"]);
  await assert.rejects(async () => {
    for await (const r of readCustomerRows(Buffer.from(await bad.xlsx.writeBuffer()))) void r;
  }, /Telefon/);
});
