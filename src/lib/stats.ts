import type { DailyMetric, Significance, Variant, VariantStats } from "@/lib/types";

function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function twoPropP(a: number, na: number, b: number, nb: number): number | null {
  if (na < 30 || nb < 30) return null;
  const p = (a + b) / (na + nb);
  const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
  if (se === 0) return 1;
  const z = Math.abs(a / na - b / nb) / se;
  return Math.max(0, Math.min(1, 1 - erf(z / Math.SQRT2)));
}

export function computeStats(variants: Variant[], metrics: DailyMetric[]): VariantStats[] {
  return variants.map((variant) => {
    const rows = metrics.filter((m) => m.variantId === variant.id);
    const closed = rows.filter((m) => !m.incomplete);
    const hitsView = rows.reduce((s, r) => s + r.hitsView, 0);
    const sessionView = rows.reduce((s, r) => s + r.sessionView, 0);
    const hitsTocart = rows.reduce((s, r) => s + r.hitsTocart, 0);
    const orderedUnits = rows.reduce((s, r) => s + r.orderedUnits, 0);
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const views = hitsView || sessionView;
    const incompleteUnits = rows.filter((m) => m.incomplete).reduce((s, r) => s + r.orderedUnits, 0);
    void closed;
    return {
      variant,
      hitsView,
      sessionView,
      hitsTocart,
      orderedUnits,
      revenue,
      cr: views > 0 ? hitsTocart / views : 0,
      incompleteUnits,
      adsViews: rows.reduce((s, r) => s + r.adsViews, 0),
      adsClicks: rows.reduce((s, r) => s + r.adsClicks, 0),
      adsCarts: rows.reduce((s, r) => s + r.adsCarts, 0),
      adsOrders: rows.reduce((s, r) => s + r.adsOrders, 0),
      adsSpend: rows.reduce((s, r) => s + r.adsSpend, 0),
      adsRevenue: rows.reduce((s, r) => s + r.adsRevenue, 0),
      adsCtr: (() => {
        const v = rows.reduce((s, r) => s + r.adsViews, 0);
        const c = rows.reduce((s, r) => s + r.adsClicks, 0);
        return v > 0 ? c / v : 0;
      })(),
    };
  });
}

export function computeSignificance(stats: VariantStats[]): Significance {
  const control = stats.find((s) => s.variant.isControl) ?? stats[0];
  if (!control || stats.length < 2) {
    return { winnerLabel: null, pValue: null, ready: false, note: "Нужно минимум два варианта." };
  }
  let best = control;
  for (const s of stats) {
    const metric = (x: VariantStats) => (x.hitsView ? x.cr : x.orderedUnits);
    if (metric(s) > metric(best)) best = s;
  }
  const viewsA = control.hitsView || control.sessionView;
  const viewsB = best.hitsView || best.sessionView;
  const p =
    viewsA && viewsB
      ? twoPropP(control.hitsTocart, viewsA, best.hitsTocart, viewsB)
      : twoPropP(control.orderedUnits, Math.max(control.orderedUnits, 30), best.orderedUnits, Math.max(best.orderedUnits, 30));
  const ready = p !== null && p < 0.05 && best.variant.id !== control.variant.id;
  return {
    winnerLabel: ready ? best.variant.label : null,
    pValue: p,
    ready,
    note: viewsA && viewsB
      ? ready
        ? `Вариант ${best.variant.label} значимо лучше (p=${p?.toFixed(3)}).`
        : "Показов мало или разница ещё не значима. Сегодняшний день в z-тест не входит."
      : "Сравниваем по штукам из отгрузок: один заказ на 3 шт. считается как 3. Показы в API только с Premium Plus. Сегодняшние штуки в значимость не входят.",
  };
}
