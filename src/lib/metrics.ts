export type Funnel = {
  hitsView: number;
  sessionView: number;
  hitsTocart: number;
  orderedUnits: number;
  revenue: number;
};

export const emptyFunnel = (): Funnel => ({
  hitsView: 0,
  sessionView: 0,
  hitsTocart: 0,
  orderedUnits: 0,
  revenue: 0,
});

function asTime(v: unknown): number {
  if (!v) return NaN;
  if (v instanceof Date) return v.getTime();
  return new Date(String(v)).getTime();
}

export function moscowYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function moscowDayStartMs(day: string): number {
  return new Date(`${day}T00:00:00+03:00`).getTime();
}

export function eachDay(from: string, toInclusive: string): string[] {
  const out: string[] = [];
  let t = moscowDayStartMs(from);
  const end = moscowDayStartMs(toInclusive);
  if (!Number.isFinite(t) || !Number.isFinite(end) || t > end) return out;
  while (t <= end) {
    out.push(moscowYmd(new Date(t)));
    t += 86400000;
  }
  return out;
}

export type PeriodLike = { variant_id: string; started_at: unknown; ended_at: unknown };

export function periodOverlapMs(
  startedAt: unknown,
  endedAt: unknown,
  winStart: number,
  winEnd: number,
  now = Date.now(),
): number {
  const a = asTime(startedAt);
  const b = endedAt ? asTime(endedAt) : now;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const lo = Math.max(a, winStart);
  const hi = Math.min(b, winEnd, now);
  return Math.max(0, hi - lo);
}

export function coveragesForDay(periods: PeriodLike[], day: string, now = Date.now()): Map<string, number> {
  const start = moscowDayStartMs(day);
  const end = start + 86400000;
  const map = new Map<string, number>();
  for (const p of periods) {
    const ms = periodOverlapMs(p.started_at, p.ended_at, start, end, now);
    if (ms <= 0) continue;
    map.set(p.variant_id, (map.get(p.variant_id) ?? 0) + ms);
  }
  return map;
}

function splitInt(total: number, weights: Map<string, number>): Map<string, number> {
  const keys = [...weights.keys()];
  const sumW = keys.reduce((s, k) => s + (weights.get(k) ?? 0), 0);
  const out = new Map<string, number>();
  if (total <= 0 || sumW <= 0) {
    for (const k of keys) out.set(k, 0);
    return out;
  }
  const parts = keys.map((k) => {
    const exact = (total * (weights.get(k) ?? 0)) / sumW;
    return { k, n: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let leftover = total - parts.reduce((s, p) => s + p.n, 0);
  parts.sort((a, b) => b.frac - a.frac);
  for (const p of parts) {
    if (leftover <= 0) break;
    p.n += 1;
    leftover -= 1;
  }
  for (const p of parts) out.set(p.k, p.n);
  return out;
}

export function splitFunnel(funnel: Funnel, weights: Map<string, number>): Map<string, Funnel> {
  const views = splitInt(funnel.hitsView, weights);
  const sessions = splitInt(funnel.sessionView, weights);
  const carts = splitInt(funnel.hitsTocart, weights);
  const orders = splitInt(funnel.orderedUnits, weights);
  const sumW = [...weights.values()].reduce((s, n) => s + n, 0);
  const out = new Map<string, Funnel>();
  for (const k of weights.keys()) {
    out.set(k, {
      hitsView: views.get(k) ?? 0,
      sessionView: sessions.get(k) ?? 0,
      hitsTocart: carts.get(k) ?? 0,
      orderedUnits: orders.get(k) ?? 0,
      revenue: sumW > 0 ? funnel.revenue * ((weights.get(k) ?? 0) / sumW) : 0,
    });
  }
  return out;
}

export function parseMetricVector(raw: unknown, names: readonly string[]): Record<string, number> | null {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return {};
    if (raw.every((x) => typeof x === "number" || typeof x === "string")) {
      const out: Record<string, number> = {};
      names.forEach((n, i) => {
        out[n] = i < raw.length ? Number(raw[i] ?? 0) || 0 : 0;
      });
      return out;
    }
    if (raw.every((x) => x && typeof x === "object")) {
      const out: Record<string, number> = {};
      for (const item of raw as { name?: string; metric?: string; key?: string; value?: unknown; id?: string }[]) {
        const key = item.name ?? item.metric ?? item.key ?? item.id;
        if (key) out[key] = Number(item.value ?? 0) || 0;
      }
      return out;
    }
    return null;
  }
  if (raw && typeof raw === "object") {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "number" || typeof v === "string") out[k] = Number(v) || 0;
    }
    return out;
  }
  return null;
}

export function funnelFromNamed(named: Record<string, number>): Funnel {
  return {
    hitsView: named.hits_view ?? 0,
    sessionView: named.session_view ?? 0,
    hitsTocart: named.hits_tocart ?? 0,
    orderedUnits: named.ordered_units ?? 0,
    revenue: named.revenue ?? 0,
  };
}

export function sanitizeFunnel(m: Funnel): Funnel {
  const next = { ...m };
  const views = next.hitsView || next.sessionView;
  if (next.hitsTocart > 0 && views > 0 && next.hitsTocart > views) {
    next.hitsView = 0;
    next.sessionView = 0;
    next.hitsTocart = 0;
  }
  if (next.hitsView === 0 && next.sessionView === 0 && next.hitsTocart > 0) next.hitsTocart = 0;
  if (next.orderedUnits < 0) next.orderedUnits = 0;
  if (next.revenue < 0) next.revenue = 0;
  return next;
}

export function addFunnel(a: Funnel, b: Funnel): Funnel {
  return {
    hitsView: a.hitsView + b.hitsView,
    sessionView: a.sessionView + b.sessionView,
    hitsTocart: a.hitsTocart + b.hitsTocart,
    orderedUnits: a.orderedUnits + b.orderedUnits,
    revenue: a.revenue + b.revenue,
  };
}
