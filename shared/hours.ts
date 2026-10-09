/** Çalışma saatleri: hafta içi ve hafta sonu için ayrı açılış/kapanış (HH:MM). Saat dilimi her zaman İstanbul. */
export interface DayHours {
  open: string;
  close: string;
}

export interface HoursConfig {
  /** Kapalıyken sipariş almayı engelle (kapalıysa müşteriye kapalı mesajı gider) */
  enabled: boolean;
  weekday: DayHours;
  weekend: DayHours;
}

export const DEFAULT_HOURS: HoursConfig = {
  enabled: true,
  weekday: { open: "10:45", close: "21:30" },
  weekend: { open: "10:00", close: "21:00" },
};

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const isWeekend = (dow: number) => dow === 0 || dow === 6;
const hoursOf = (cfg: HoursConfig, dow: number) => (isWeekend(dow) ? cfg.weekend : cfg.weekday);

/** İstanbul'daki gün (0=Pazar) ve gün içi dakika. */
export function istanbulClock(now: Date): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Istanbul", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return { dow: WEEKDAY_INDEX[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Kapanış açılıştan küçük ya da eşitse gece yarısını geçen vardiya sayılır (örn. 18:00–02:00). */
function openAt(h: DayHours, minutes: number): boolean {
  const o = toMinutes(h.open);
  const c = toMinutes(h.close);
  return o < c ? minutes >= o && minutes < c : minutes >= o || minutes < c;
}

export function isOpenNow(cfg: HoursConfig, now: Date): boolean {
  if (!cfg.enabled) return true;
  const { dow, minutes } = istanbulClock(now);
  const o = toMinutes(hoursOf(cfg, dow).open);
  const c = toMinutes(hoursOf(cfg, dow).close);
  if (o < c) return openAt(hoursOf(cfg, dow), minutes);
  if (minutes >= o) return true; // bugünkü vardiya başladı
  const prev = hoursOf(cfg, (dow + 6) % 7); // dünkü vardiya gece yarısını geçip sürüyor mu
  const po = toMinutes(prev.open);
  const pc = toMinutes(prev.close);
  return po >= pc && minutes < pc;
}

/** "Bugün 10:45", "Yarın 10:00" ya da "Cumartesi 10:00": bir sonraki açılış. */
export function nextOpeningText(cfg: HoursConfig, now: Date): string {
  const { dow, minutes } = istanbulClock(now);
  for (let offset = 0; offset <= 7; offset++) {
    const d = (dow + offset) % 7;
    const h = hoursOf(cfg, d);
    if (offset === 0 && minutes >= toMinutes(h.open)) continue;
    const label = offset === 0 ? "Bugün" : offset === 1 ? "Yarın" : DAY_NAMES[d];
    return `${label} ${h.open}`;
  }
  return `${cfg.weekday.open}`;
}

export function hoursSummary(cfg: HoursConfig): string {
  const same = cfg.weekday.open === cfg.weekend.open && cfg.weekday.close === cfg.weekend.close;
  return same ? `Her gün ${cfg.weekday.open}–${cfg.weekday.close}` : `Hafta içi ${cfg.weekday.open}–${cfg.weekday.close}, hafta sonu ${cfg.weekend.open}–${cfg.weekend.close}`;
}

/** Açılıştan bu kadar dakika önce sipariş alınmaya başlanır (sipariş açılışta hazırlanır). */
export const PRE_OPEN_MINUTES = 60;

/** Kapalıysa bir sonraki açılışa kaç dakika var; açıksa 0. */
export function minutesUntilOpen(cfg: HoursConfig, now: Date): number {
  if (isOpenNow(cfg, now)) return 0;
  const { dow, minutes } = istanbulClock(now);
  for (let offset = 0; offset <= 7; offset++) {
    const open = toMinutes(hoursOf(cfg, (dow + offset) % 7).open);
    if (offset === 0 && minutes >= open) continue;
    return offset * 1440 + open - minutes;
  }
  return 0;
}

export type OrderingState = "open" | "pre" | "closed";

/** open: açık · pre: kapalı ama açılışa en çok 1 saat var (sipariş alınır) · closed: sipariş alınmaz */
export function orderingState(cfg: HoursConfig, now: Date): OrderingState {
  if (isOpenNow(cfg, now)) return "open";
  return minutesUntilOpen(cfg, now) <= PRE_OPEN_MINUTES ? "pre" : "closed";
}
