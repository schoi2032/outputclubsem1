export const TZ = process.env.SCHOOL_TZ || "Asia/Seoul";
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function schoolNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const pick = (t: string) => parts.find((p) => p.type === t)!.value;
  return { day: DAYS.indexOf(pick("weekday")), time: `${pick("hour")}:${pick("minute")}` };
}

export function schoolDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

export function daysUntil(dayName: string, today: number) {
  return (DAYS.indexOf(dayName) - today + 7) % 7;
}

export function whenLabel(n: number) {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}
