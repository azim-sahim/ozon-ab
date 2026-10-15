export type TaxRegime = "usn6" | "usn8" | "usn15" | "npd4" | "npd6" | "custom" | "none";

export const TAX_REGIMES: { id: TaxRegime; label: string; rate: number; base: "revenue" | "profit" }[] = [
  { id: "usn6", label: "УСН «Доходы» 6% с реализации", rate: 6, base: "revenue" },
  { id: "usn8", label: "УСН «Доходы» 8% с реализации", rate: 8, base: "revenue" },
  { id: "usn15", label: "УСН «Доходы − расходы» 15%", rate: 15, base: "profit" },
  { id: "npd4", label: "НПД 4% с реализации", rate: 4, base: "revenue" },
  { id: "npd6", label: "НПД 6% с реализации", rate: 6, base: "revenue" },
  { id: "custom", label: "Своя ставка % от реализации", rate: 6, base: "revenue" },
  { id: "none", label: "Без налога", rate: 0, base: "revenue" },
];

export function taxBase(regime: string): "revenue" | "profit" {
  return TAX_REGIMES.find((r) => r.id === regime)?.base ?? "revenue";
}

export function defaultTaxRate(regime: string): number {
  return TAX_REGIMES.find((r) => r.id === regime)?.rate ?? 6;
}

/** Налог: УСН доходы / НПД — % от реализации (продажи − возвраты), не от выплаты и не от валовой выручки. */
export function realizationAmount(revenue: number, returns: number): number {
  return Math.max(0, Number(revenue) || 0) - Math.max(0, Number(returns) || 0);
}

export function computeTax(opts: {
  regime: string;
  rate: number;
  revenue: number;
  returns?: number;
  profitBeforeTax: number;
}): number {
  const rate = Math.max(0, Number(opts.rate) || 0) / 100;
  if (opts.regime === "none" || rate === 0) return 0;
  if (taxBase(opts.regime) === "profit") return Math.max(0, opts.profitBeforeTax) * rate;
  return Math.max(0, realizationAmount(opts.revenue, opts.returns ?? 0)) * rate;
}

export type MoneyFlow = {
  units: number;
  revenue: number;
  commission: number;
  logistics: number;
  returns: number;
  storage: number;
  penalties: number;
  adsHold: number;
  otherHold: number;
  payout: number;
  ads: number;
  cogs: number;
  extra: number;
  tax: number;
  profit: number;
  realization: number;
};

export function emptyFlow(): MoneyFlow {
  return {
    units: 0,
    revenue: 0,
    commission: 0,
    logistics: 0,
    returns: 0,
    storage: 0,
    penalties: 0,
    adsHold: 0,
    otherHold: 0,
    payout: 0,
    ads: 0,
    cogs: 0,
    extra: 0,
    tax: 0,
    profit: 0,
    realization: 0,
  };
}

export function addFlow(a: MoneyFlow, b: MoneyFlow): MoneyFlow {
  return {
    units: a.units + b.units,
    revenue: a.revenue + b.revenue,
    commission: a.commission + b.commission,
    logistics: a.logistics + b.logistics,
    returns: a.returns + b.returns,
    storage: a.storage + b.storage,
    penalties: a.penalties + b.penalties,
    adsHold: a.adsHold + b.adsHold,
    otherHold: a.otherHold + b.otherHold,
    payout: a.payout + b.payout,
    ads: a.ads + b.ads,
    cogs: a.cogs + b.cogs,
    extra: a.extra + b.extra,
    tax: a.tax + b.tax,
    profit: a.profit + b.profit,
    realization: a.realization + b.realization,
  };
}

export function finalizeFlow(
  raw: Omit<MoneyFlow, "tax" | "profit">,
  tax: { regime: string; rate: number },
): MoneyFlow {
  const holds =
    raw.commission + raw.logistics + raw.returns + raw.storage + raw.penalties + raw.adsHold + raw.otherHold;
  const payout = raw.payout || raw.revenue - holds;
  const adsExtra = Math.max(0, raw.ads - raw.adsHold);
  const profitBeforeTax = payout - raw.cogs - raw.extra - adsExtra;
  const taxValue = computeTax({
    regime: tax.regime,
    rate: tax.rate,
    revenue: raw.realization > 0 ? raw.realization : raw.revenue,
    returns: raw.returns,
    profitBeforeTax,
  });
  return { ...raw, payout, tax: taxValue, profit: profitBeforeTax - taxValue };
}

export function marginPct(profit: number, revenue: number): number | null {
  if (!revenue) return null;
  return (profit / revenue) * 100;
}

export function roiPct(profit: number, cogs: number): number | null {
  if (!cogs) return null;
  return (profit / cogs) * 100;
}

export function drrPct(ads: number, revenue: number): number | null {
  if (!revenue) return null;
  return (ads / revenue) * 100;
}
