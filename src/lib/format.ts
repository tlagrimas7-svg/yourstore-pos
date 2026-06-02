export function fmt(n: number, currency = "₱") {
  return `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function todayKey(d: Date = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function isSameDay(iso: string, ref: Date = new Date()) {
  return iso.slice(0, 10) === todayKey(ref);
}

export function monthKey(d: Date = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isSameMonth(iso: string, year: number, month: number) {
  const d = new Date(iso);
  return d.getFullYear() === year && d.getMonth() === month;
}