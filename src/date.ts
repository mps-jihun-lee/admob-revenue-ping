export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function previousDate(now: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMidnight = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
  ));
  localMidnight.setUTCDate(localMidnight.getUTCDate() - 1);
  return {
    year: localMidnight.getUTCFullYear(),
    month: localMidnight.getUTCMonth() + 1,
    day: localMidnight.getUTCDate(),
  };
}

export function dateKey(date: CalendarDate): string {
  return [date.year, date.month, date.day]
    .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, "0"))
    .join("-");
}
