import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { DEMO_PRODUCTS } from "@/lib/ozon/demo";
import { fetchCashFlow, fetchFinanceTransactions, type FinanceLine } from "@/lib/ozon/finance";
import { productsBySkus } from "@/lib/ozon/client";
import { fetchAdsStats } from "@/lib/ozon/performance";
import {
  addFlow,
  defaultTaxRate,
  emptyFlow,
  finalizeFlow,
  drrPct,
  marginPct,
  roiPct,
  type MoneyFlow,
} from "@/lib/profit";
import type { ProfitReport, ProfitSkuRow, SkuCost } from "@/lib/types";

function nid() {
  return crypto.randomUUID();
}

function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function shopMeta(userId: string, shopId: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    is_demo: boolean;
    tax_regime: string | null;
    tax_rate: unknown;
    extra_monthly: unknown;
  }>`select id, name, is_demo, tax_regime, tax_rate, extra_monthly from shops where id = ${shopId} and user_id = ${userId}`;
  if (!rows[0]) throw new Error("Магазин не найден");
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    demo: row.is_demo === true || row.is_demo === ("t" as unknown as boolean),
    taxRegime: row.tax_regime || "usn6",
    taxRate: money(row.tax_rate) || defaultTaxRate(row.tax_regime || "usn6"),
    extraMonthly: money(row.extra_monthly),
  };
}

function demoLines(from: string, to: string): FinanceLine[] {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const out: FinanceLine[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start + i * 86400000).toISOString().slice(0, 10);
    for (const p of DEMO_PRODUCTS) {
      const seed = Number(p.sku?.slice(-2) ?? 1);
      const units = 1 + ((seed + i) % 3);
      const price = Number(p.price ?? 890);
      const revenue = units * price;
      const commission = revenue * 0.15;
      const logistics = units * 85;
      const adsHold = i % 4 === 0 ? revenue * 0.04 : 0;
      const storage = i % 7 === 0 ? 18 : 0;
      out.push({
        day,
        sku: p.sku ?? p.offerId,
        name: p.name,
        units,
        revenue,
        commission,
        logistics,
        returns: i % 11 === 0 ? price * 0.3 : 0,
        storage,
        penalties: 0,
        adsHold,
        otherHold: 0,
        payout: revenue - commission - logistics - adsHold - storage,
        realization: revenue,
      });
    }
  }
  return out;
}

async function loadCosts(userId: string, shopId: string): Promise<Map<string, SkuCost>> {
  const sql = await getSql();
  const rows = await sql<{
    sku: string;
    offer_id: string | null;
    name: string | null;
    image: string | null;
    cost: unknown;
    packing: unknown;
  }>`select sku, offer_id, name, image, cost, packing from sku_costs where user_id = ${userId} and shop_id = ${shopId}`;
  const map = new Map<string, SkuCost>();
  for (const r of rows) {
    map.set(r.sku, {
      sku: r.sku,
      offerId: r.offer_id,
      name: r.name,
      image: r.image,
      cost: money(r.cost),
      packing: money(r.packing),
    });
  }
  return map;
}

async function rememberCatalog(
  userId: string,
  shopId: string,
  items: { sku: string; name?: string | null; image?: string | null; offerId?: string | null }[],
) {
  const sql = await getSql();
  for (const item of items) {
    const sku = item.sku.trim();
    if (!sku) continue;
    const name = item.name?.trim() || null;
    const image = item.image?.trim() || null;
    const offer = item.offerId?.trim() || null;
    const existing = await sql<{ id: string }>`
      select id from sku_costs where shop_id = ${shopId} and user_id = ${userId} and sku = ${sku}`;
    if (existing[0]) {
      await sql`update sku_costs set
        name = coalesce(${name}, name),
        image = coalesce(${image}, image),
        offer_id = coalesce(${offer}, offer_id),
        updated_at = now()
        where id = ${existing[0].id}`;
    } else {
      await sql`insert into sku_costs (id, user_id, shop_id, sku, offer_id, name, image, cost, packing)
        values (${nid()}, ${userId}, ${shopId}, ${sku}, ${offer}, ${name}, ${image}, ${0}, ${0})`;
    }
  }
}

function catalogFromDemo(skus: string[]) {
  const set = new Set(skus);
  return DEMO_PRODUCTS.filter((p) => (p.sku && set.has(p.sku)) || p.skus.some((s) => set.has(s))).flatMap((p) => {
    const keys = p.skus.length ? p.skus : p.sku ? [p.sku] : [];
    return keys.map((sku) => ({ sku, name: p.name, image: p.images[0] ?? null, offerId: p.offerId }));
  });
}

async function fillCatalog(userId: string, shopId: string, skus: string[], creds?: { clientId: string; apiKey: string }, demo = false) {
  const need = [...new Set(skus.filter(Boolean))];
  if (!need.length) return loadCosts(userId, shopId);
  const current = await loadCosts(userId, shopId);
  const missing = need.filter((s) => {
    const c = current.get(s);
    return !c?.name || c.name === s || !c.image;
  });
  if (missing.length) {
    const found = demo
      ? catalogFromDemo(missing)
      : creds
        ? (await productsBySkus(creds, missing)).flatMap((p) => {
            const keys = new Set([p.sku, ...p.skus].filter(Boolean));
            return missing
              .filter((sku) => keys.has(sku))
              .map((sku) => ({ sku, name: p.name, image: p.images[0] ?? null, offerId: p.offerId }));
          })
        : [];
    if (found.length) await rememberCatalog(userId, shopId, found);
  }
  return loadCosts(userId, shopId);
}

function toRow(sku: string, name: string, flow: MoneyFlow, missingCost: boolean, image: string | null): ProfitSkuRow {
  return {
    sku,
    name: name || (sku ? sku : "Прочие начисления Ozon"),
    image,
    units: Math.round(flow.units),
    revenue: flow.revenue,
    commission: flow.commission,
    logistics: flow.logistics,
    returns: flow.returns,
    storage: flow.storage,
    penalties: flow.penalties,
    otherHold: flow.otherHold,
    payout: flow.payout,
    ads: flow.ads,
    cogs: flow.cogs,
    extra: flow.extra,
    tax: flow.tax,
    profit: flow.profit,
    margin: marginPct(flow.profit, flow.revenue),
    roi: roiPct(flow.profit, flow.cogs),
    drr: drrPct(flow.ads, flow.revenue),
    missingCost,
    realization: flow.realization,
  };
}

type FinAgg = {
  sku: string;
  name: string | null;
  units: unknown;
  revenue: unknown;
  commission: unknown;
  logistics: unknown;
  returns: unknown;
  storage: unknown;
  penalties: unknown;
  ads_hold: unknown;
  other_hold: unknown;
  payout: unknown;
  realization: unknown;
};

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00+03:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(d);
}

function monthStart(ymd: string): string {
  return `${ymd.slice(0, 8)}01`;
}

function adsForPeriod(rows: { day: string; sku: string | null; spend: number }[], from: string, to: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.day && (row.day < from || row.day > to)) continue;
    const key = row.sku ? String(row.sku) : "";
    map.set(key, (map.get(key) ?? 0) + row.spend);
  }
  return map;
}

function buildReport(
  days: FinAgg[],
  adsBySku: Map<string, number>,
  costs: Map<string, SkuCost>,
  shop: { id: string; name: string; demo: boolean; taxRegime: string; taxRate: number; extraMonthly: number },
  from: string,
  to: string,
  adsNote: string,
  ozonFinance: ProfitReport["ozonFinance"],
): ProfitReport {
  const fromMs = new Date(`${from}T00:00:00+03:00`).getTime();
  const toMs = new Date(`${to}T00:00:00+03:00`).getTime();
  const periodDays = Math.max(1, Math.round((toMs - fromMs) / 86400000) + 1);
  const extraTotal = (shop.extraMonthly / 30) * periodDays;

  const raws: { sku: string; name: string; image: string | null; flow: Omit<MoneyFlow, "tax" | "profit">; missingCost: boolean }[] = [];
  let revenueSum = 0;
  for (const row of days) {
    const sku = row.sku ?? "";
    const units = money(row.units);
    const cost = costs.get(sku);
    const perUnit = cost
      ? cost.cost + cost.packing
      : shop.demo && units
        ? (money(row.revenue) * 0.38) / units
        : 0;
    const cogs = Math.max(0, units) * perUnit;
    const adsHold = money(row.ads_hold);
    const titled =
      cost?.name && cost.name !== sku
        ? cost.name
        : row.name && row.name !== sku
          ? row.name
          : sku
            ? sku
            : "Прочие начисления Ozon";
    raws.push({
      sku,
      name: titled,
      image: sku ? cost?.image ?? null : null,
      missingCost: units > 0 && (cost?.cost ?? 0) + (cost?.packing ?? 0) === 0 && !shop.demo,
      flow: {
        units,
        revenue: money(row.revenue),
        commission: money(row.commission),
        logistics: money(row.logistics),
        returns: money(row.returns),
        storage: money(row.storage),
        penalties: money(row.penalties),
        adsHold,
        otherHold: money(row.other_hold),
        payout: money(row.payout),
        ads: adsHold,
        cogs,
        extra: 0,
        realization: money(row.realization) || money(row.revenue),
      },
    });
    revenueSum += money(row.revenue);
  }

  const used = new Set<string>();
  for (const r of raws) {
    const offer = costs.get(r.sku)?.offerId ?? "";
    const spend = (r.sku && adsBySku.get(r.sku)) || (offer && adsBySku.get(offer)) || 0;
    if (r.sku && adsBySku.has(r.sku)) used.add(r.sku);
    if (offer && adsBySku.has(offer)) used.add(offer);
    if (spend > 0) r.flow.ads = spend;
  }
  let leftover = 0;
  for (const [key, spend] of adsBySku) {
    if (!used.has(key)) leftover += spend;
  }
  if (leftover > 0 && revenueSum > 0) {
    for (const r of raws) {
      if (!r.sku) continue;
      r.flow.ads += leftover * (r.flow.revenue / revenueSum);
    }
  } else if (leftover > 0) {
    raws.push({
      sku: "",
      name: "Реклама без привязки к SKU",
      image: null,
      missingCost: false,
      flow: { ...emptyFlow(), ads: leftover },
    });
  }

  for (const r of raws) {
    r.flow.extra = revenueSum > 0 ? extraTotal * (r.flow.revenue / revenueSum) : extraTotal / Math.max(1, raws.length);
  }

  const tax = { regime: shop.taxRegime, rate: shop.taxRate };
  const rows = raws
    .map((r) => toRow(r.sku, r.name, finalizeFlow(r.flow, tax), r.missingCost, r.image))
    .sort((a, b) => b.revenue - a.revenue || b.profit - a.profit);

  const totalsFlow = raws.reduce((acc, r) => addFlow(acc, finalizeFlow(r.flow, tax)), emptyFlow());
  const totals = toRow("", shop.name, totalsFlow, false, null);
  totals.name = "Итого";
  totals.sku = "";
  totals.missingCost = false;

  return {
    shopId: shop.id,
    shopName: shop.name,
    from,
    to,
    taxRegime: shop.taxRegime,
    taxRate: shop.taxRate,
    extraMonthly: shop.extraMonthly,
    adsNote,
    ozonFinance,
    totals,
    rows,
    missingCostCount: rows.filter((r) => r.missingCost).length,
  };
}

export const saveFinanceSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { shopId: string; taxRegime: string; taxRate: number; extraMonthly: number }) => d)
  .handler(async ({ context, data }) => {
    const rate = Math.max(0, Math.min(40, Number(data.taxRate) || 0));
    const extra = Math.max(0, Number(data.extraMonthly) || 0);
    const sql = await getSql();
    await sql`update shops set tax_regime = ${data.taxRegime}, tax_rate = ${rate}, extra_monthly = ${extra}
      where id = ${data.shopId} and user_id = ${context.userId}`;
    return { ok: true };
  });

export const listSkuCosts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((shopId: string) => shopId)
  .handler(async ({ context, data: shopId }) => {
    const map = await loadCosts(context.userId, shopId);
    return [...map.values()].sort((a, b) => (a.name ?? a.sku).localeCompare(b.name ?? b.sku, "ru"));
  });

export const saveSkuCost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { shopId: string; sku: string; name?: string; cost: number; packing: number }) => d)
  .handler(async ({ context, data }) => {
    const sku = data.sku.trim();
    if (!sku) throw new Error("Укажите SKU");
    const cost = Math.max(0, Number(data.cost) || 0);
    const packing = Math.max(0, Number(data.packing) || 0);
    const sql = await getSql();
    const existing = await sql<{ id: string }>`
      select id from sku_costs where shop_id = ${data.shopId} and user_id = ${context.userId} and sku = ${sku}`;
    if (existing[0]) {
      await sql`update sku_costs set cost = ${cost}, packing = ${packing}, name = ${data.name ?? null}, updated_at = now()
        where id = ${existing[0].id}`;
    } else {
      await sql`insert into sku_costs (id, user_id, shop_id, sku, name, cost, packing)
        values (${nid()}, ${context.userId}, ${data.shopId}, ${sku}, ${data.name ?? null}, ${cost}, ${packing})`;
    }
    return { ok: true };
  });

export const syncFinance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { shopId: string; from: string; to: string }) => d)
  .handler(async ({ context, data }) => {
    const shop = await shopMeta(context.userId, data.shopId);
    const { credsFor } = await import("./actions");
    const access = await credsFor(context.userId, data.shopId);
    const lines = shop.demo
      ? demoLines(data.from, data.to)
      : await fetchFinanceTransactions(access.creds!, data.from, data.to);
    const catalog = await fillCatalog(
      context.userId,
      data.shopId,
      lines.map((l) => l.sku),
      access.creds,
      shop.demo,
    );
    for (const line of lines) {
      const c = catalog.get(line.sku);
      if (c?.name) line.name = c.name;
    }
    const sql = await getSql();
    await sql`delete from finance_daily where shop_id = ${data.shopId} and user_id = ${context.userId}
      and day >= ${data.from}::date and day <= ${data.to}::date`;
    for (const line of lines) {
      await sql`insert into finance_daily (
          id, user_id, shop_id, sku, name, day, units, revenue, realization, commission, logistics, returns, storage, penalties, ads_hold, other_hold, payout
        ) values (
          ${nid()}, ${context.userId}, ${data.shopId}, ${line.sku}, ${line.name}, ${line.day}::date,
          ${Math.round(line.units)}, ${line.revenue}, ${line.realization}, ${line.commission}, ${line.logistics}, ${line.returns},
          ${line.storage}, ${line.penalties}, ${line.adsHold}, ${line.otherHold}, ${line.payout}
        )
        on conflict (shop_id, sku, day) do update set
          name = excluded.name,
          units = finance_daily.units + excluded.units,
          revenue = finance_daily.revenue + excluded.revenue,
          realization = finance_daily.realization + excluded.realization,
          commission = finance_daily.commission + excluded.commission,
          logistics = finance_daily.logistics + excluded.logistics,
          returns = finance_daily.returns + excluded.returns,
          storage = finance_daily.storage + excluded.storage,
          penalties = finance_daily.penalties + excluded.penalties,
          ads_hold = finance_daily.ads_hold + excluded.ads_hold,
          other_hold = finance_daily.other_hold + excluded.other_hold,
          payout = finance_daily.payout + excluded.payout`;
    }
    return { rows: lines.length };
  });

export const getProfitReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { shopId: string; from: string; to: string }) => d)
  .handler(async ({ context, data }): Promise<ProfitReport> => {
    const shop = await shopMeta(context.userId, data.shopId);
    const sql = await getSql();
    const days = await sql<FinAgg>`select sku, max(name) as name, sum(units) as units, sum(revenue) as revenue, sum(realization) as realization, sum(commission) as commission,
        sum(logistics) as logistics, sum(returns) as returns, sum(storage) as storage, sum(penalties) as penalties,
        sum(ads_hold) as ads_hold, sum(other_hold) as other_hold, sum(payout) as payout
      from finance_daily
      where shop_id = ${data.shopId} and user_id = ${context.userId}
        and day >= ${data.from}::date and day <= ${data.to}::date
      group by sku`;

    const { credsFor } = await import("./actions");
    const access = shop.demo ? { creds: undefined, perf: undefined } : await credsFor(context.userId, data.shopId);
    const costs = await fillCatalog(
      context.userId,
      data.shopId,
      days.map((d) => d.sku).filter(Boolean),
      access.creds,
      shop.demo,
    );
    const adsBySku = new Map<string, number>();
    let adsNote = "Реклама: удержания из отчёта начислений Ozon";
    if (!shop.demo && access.perf) {
      const ads = await fetchAdsStats(access.perf, { dateFrom: data.from, dateTo: data.to, skus: [] });
      adsNote = ads.note;
      for (const row of ads.rows) {
        const key = row.sku ? String(row.sku) : "";
        adsBySku.set(key, (adsBySku.get(key) ?? 0) + row.spend);
      }
    } else if (shop.demo) {
      adsNote = "Демо: реклама как доля выручки + удержания Ozon";
      for (const row of days) adsBySku.set(row.sku, money(row.revenue) * 0.08);
    }

    let ozonFinance: ProfitReport["ozonFinance"] = null;
    if (!shop.demo && access.creds) {
      const stmt = await fetchCashFlow(access.creds, data.from, data.to);
      if (stmt) ozonFinance = { revenue: stmt.revenue, payout: stmt.payout, paid: stmt.paid };
    }

    return buildReport(days, adsBySku, costs, shop, data.from, data.to, adsNote, ozonFinance);
  });

export const getProfitDashboard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { shopId: string; today: string; period: "today" | "yesterday" | "month" | "lastMonth" }) => d)
  .handler(async ({ context, data }) => {
    const today = data.today;
    const yesterday = shiftYmd(today, -1);
    const monthFrom = monthStart(today);
    const lastEnd = shiftYmd(monthFrom, -1);
    const lastFrom = monthStart(lastEnd);
    const periods = [
      { id: "today" as const, title: "Сегодня", from: today, to: today },
      { id: "yesterday" as const, title: "Вчера", from: yesterday, to: yesterday },
      { id: "month" as const, title: "Текущий месяц", from: monthFrom, to: today },
      { id: "lastMonth" as const, title: "Прошлый месяц", from: lastFrom, to: lastEnd },
    ];
    const selected = periods.find((p) => p.id === data.period) ?? periods[3];

    const shop = await shopMeta(context.userId, data.shopId);
    const sql = await getSql();
    const daily = await sql<FinAgg & { day: string }>`
      select sku, max(name) as name, to_char(day, 'YYYY-MM-DD') as day, sum(units) as units, sum(revenue) as revenue, sum(realization) as realization,
        sum(commission) as commission, sum(logistics) as logistics, sum(returns) as returns, sum(storage) as storage,
        sum(penalties) as penalties, sum(ads_hold) as ads_hold, sum(other_hold) as other_hold, sum(payout) as payout
      from finance_daily
      where shop_id = ${data.shopId} and user_id = ${context.userId}
        and day >= ${lastFrom}::date and day <= ${today}::date
      group by sku, day`;

    const { credsFor } = await import("./actions");
    const access = shop.demo ? { creds: undefined, perf: undefined } : await credsFor(context.userId, data.shopId);
    const costs = await fillCatalog(
      context.userId,
      data.shopId,
      [...new Set(daily.map((d) => d.sku).filter(Boolean))],
      access.creds,
      shop.demo,
    );

    let adsNote = "Реклама: удержания из отчёта начислений Ozon";
    let adsRows: { day: string; sku: string | null; spend: number }[] = [];
    if (!shop.demo && access.perf) {
      const ads = await fetchAdsStats(access.perf, { dateFrom: lastFrom, dateTo: today, skus: [] });
      adsNote = ads.note;
      adsRows = ads.rows;
    } else if (shop.demo) {
      adsNote = "Демо: реклама как доля выручки";
      adsRows = daily.map((d) => ({ day: d.day.slice(0, 10), sku: d.sku, spend: money(d.revenue) * 0.08 }));
    }

    const collapse = (from: string, to: string): FinAgg[] => {
      const map = new Map<string, FinAgg>();
      for (const row of daily) {
        const day = String(row.day).slice(0, 10);
        if (day < from || day > to) continue;
        const cur = map.get(row.sku) ?? {
          sku: row.sku,
          name: row.name,
          units: 0,
          revenue: 0,
          commission: 0,
          logistics: 0,
          returns: 0,
          storage: 0,
          penalties: 0,
          ads_hold: 0,
          other_hold: 0,
          payout: 0,
          realization: 0,
        };
        cur.name = cur.name || row.name;
        cur.units = money(cur.units) + money(row.units);
        cur.revenue = money(cur.revenue) + money(row.revenue);
        cur.commission = money(cur.commission) + money(row.commission);
        cur.logistics = money(cur.logistics) + money(row.logistics);
        cur.returns = money(cur.returns) + money(row.returns);
        cur.storage = money(cur.storage) + money(row.storage);
        cur.penalties = money(cur.penalties) + money(row.penalties);
        cur.ads_hold = money(cur.ads_hold) + money(row.ads_hold);
        cur.other_hold = money(cur.other_hold) + money(row.other_hold);
        cur.payout = money(cur.payout) + money(row.payout);
        cur.realization = money(cur.realization) + money(row.realization);
        map.set(row.sku, cur);
      }
      return [...map.values()];
    };

    const cards = periods.map((p) => {
      const report = buildReport(collapse(p.from, p.to), adsForPeriod(adsRows, p.from, p.to), costs, shop, p.from, p.to, adsNote, null);
      return { ...p, totals: report.totals };
    });
    const report = buildReport(
      collapse(selected.from, selected.to),
      adsForPeriod(adsRows, selected.from, selected.to),
      costs,
      shop,
      selected.from,
      selected.to,
      adsNote,
      null,
    );

    return {
      shopId: shop.id,
      shopName: shop.name,
      adsNote,
      rangeFrom: lastFrom,
      rangeTo: today,
      periods: cards,
      selectedId: selected.id,
      rows: report.rows,
      totals: report.totals,
      missingCostCount: report.missingCostCount,
      taxRegime: shop.taxRegime,
      taxRate: shop.taxRate,
      extraMonthly: shop.extraMonthly,
    };
  });
