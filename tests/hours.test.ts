import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_HOURS, hoursSummary, isOpenNow, nextOpeningText } from "../shared/hours";

// İstanbul UTC+3: 2026-10-07 Çarşamba, 2026-10-10 Cumartesi
const at = (day: string, hhmm: string) => new Date(`2026-10-${day}T${hhmm}:00+03:00`);

test("hafta içi: açılıştan önce kapalı, açılışta açık, kapanışta kapalı", () => {
  assert.equal(isOpenNow(DEFAULT_HOURS, at("07", "10:44")), false);
  assert.equal(isOpenNow(DEFAULT_HOURS, at("07", "10:45")), true);
  assert.equal(isOpenNow(DEFAULT_HOURS, at("07", "21:29")), true);
  assert.equal(isOpenNow(DEFAULT_HOURS, at("07", "21:30")), false);
});

test("hafta sonu saatleri ayrı uygulanır", () => {
  assert.equal(isOpenNow(DEFAULT_HOURS, at("10", "10:00")), true);
  assert.equal(isOpenNow(DEFAULT_HOURS, at("10", "21:00")), false);
  assert.equal(isOpenNow(DEFAULT_HOURS, at("11", "10:30")), true); // pazar
});

test("saat kontrolü kapalıysa her zaman açık", () => {
  assert.equal(isOpenNow({ ...DEFAULT_HOURS, enabled: false }, at("07", "03:00")), true);
});

test("UTC saatinden bağımsız: İstanbul saatine göre", () => {
  assert.equal(isOpenNow(DEFAULT_HOURS, new Date("2026-10-07T07:50:00Z")), true); // 10:50 İstanbul
  assert.equal(isOpenNow(DEFAULT_HOURS, new Date("2026-10-07T07:40:00Z")), false); // 10:40 İstanbul
});

test("bir sonraki açılış metni", () => {
  assert.equal(nextOpeningText(DEFAULT_HOURS, at("07", "09:00")), "Bugün 10:45");
  assert.equal(nextOpeningText(DEFAULT_HOURS, at("07", "22:00")), "Yarın 10:45");
  assert.equal(nextOpeningText(DEFAULT_HOURS, at("09", "22:00")), "Yarın 10:00"); // cuma gecesi → cumartesi
  assert.equal(nextOpeningText({ ...DEFAULT_HOURS, weekday: { open: "10:45", close: "21:30" } }, at("10", "22:00")), "Yarın 10:00");
});

test("gece yarısını geçen vardiya", () => {
  const night = { enabled: true, weekday: { open: "18:00", close: "02:00" }, weekend: { open: "18:00", close: "02:00" } };
  assert.equal(isOpenNow(night, at("07", "23:00")), true);
  assert.equal(isOpenNow(night, at("08", "01:30")), true);
  assert.equal(isOpenNow(night, at("08", "02:00")), false);
  assert.equal(isOpenNow(night, at("08", "12:00")), false);
});

test("özet metni", () => {
  assert.equal(hoursSummary(DEFAULT_HOURS), "Hafta içi 10:45–21:30, hafta sonu 10:00–21:00");
  assert.equal(hoursSummary({ ...DEFAULT_HOURS, weekend: DEFAULT_HOURS.weekday }), "Her gün 10:45–21:30");
});
