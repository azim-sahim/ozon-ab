import { ozonRequest, type ShopCreds } from "./client";
import { eachDay } from "@/lib/metrics";

export type FinanceLine = {
  day: string;
  sku: string;
  name: string;
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
  realization: number;
  credits?: number;
};

export type CashFlowSummary = {
  revenue: number;
  payout: number;
  paid: number;
  periods: number;
};

type Money = { amount?: string | number | null; currency?: string | null };
type Fee = { accrued?: Money; type_id?: number; accrual_id?: number; amount?: Money | number | string };
type AccrualType = { id?: number; name?: string; description?: string };

type ProductAccrual = {
  sku?: number | string;
  name?: string;
  quantity?: number;
  commission?: {
    bonus?: Money;
    coinvestment?: Money;
    commission?: Money;
    sale_amount?: Money;
    sale_commission?: Money;
    sale_price?: Money;
    seller_price?: Money;
  };
  delivery?: { total_accrued?: Money; services?: Fee[] };
};

type ByDayAccrual = {
  accrual_id?: number | string;
  type_id?: number;
  accrued_category?: string;
  date?: string;
  unit_number?: string;
  total_amount?: Money;
  accrued?: Money;
  non_item_fee?: Fee | Fee[];
  item_fees?: { fees?: { sku?: number | string; fees?: Fee[] }[] } | { sku?: number | string; fees?: Fee[] }[];
  posting?: { posting_number?: string; products?: ProductAccrual[] };
  container_fees?: { fees?: Fee[] } | Fee[];
};

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").replace(/\s/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof v === "object" && "amount" in v) return num((v as Money).amount);
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dayOf(v: unknown, fallback = ""): string {
  const s = String(v ?? "");
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : fallback;
}

function emptyLine(day: string, sku: string, name: string): FinanceLine {
  return {
    day,
    sku,
    name,
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
    realization: 0,
    credits: 0,
  };
}

type Bucket = "sale" | "return" | "commission" | "logistics" | "storage" | "ads" | "penalties" | "other";

function classifyName(raw: string): Bucket {
  const name = raw.toLowerCase();
  if (name.includes("возврат") || name.includes("return") || name.includes("невыкуп") || name.includes("отмен")) {
    return "return";
  }
  if (
    name.includes("реклам") ||
    name.includes("продвижен") ||
    name.includes("трафарет") ||
    name.includes("вывод в топ") ||
    name.includes("promotion") ||
    name.includes("stars")
  ) {
    return "ads";
  }
  if (name.includes("хранен") || name.includes("утилиз") || name.includes("storage") || name.includes("disposal")) {
    return "storage";
  }
  if (name.includes("штраф") || name.includes("fine") || name.includes("penalty") || name.includes("недовлож")) {
    return "penalties";
  }
  if (
    name.includes("логист") ||
    name.includes("достав") ||
    name.includes("последн") ||
    name.includes("миля") ||
    name.includes("обработк") ||
    name.includes("drop-off") ||
    name.includes("delivery")
  ) {
    return "logistics";
  }
  if (name.includes("комисс") || name.includes("вознагражд") || name.includes("эквайр") || name.includes("acquiring")) {
    return "commission";
  }
  if (
    name.includes("выручк") ||
    name.includes("продаж") ||
    name.includes("sale") ||
    name.includes("начислен за товар") ||
    name.includes("компенсац")
  ) {
    return "sale";
  }
  return "other";
}

function applyBucket(line: FinanceLine, bucket: Bucket, signed: number) {
  if (!signed) return;
  const hold = Math.abs(signed);
  if (bucket === "sale") {
    if (signed >= 0) line.revenue += signed;
    else line.returns += hold;
  } else if (bucket === "return") line.returns += hold;
  else if (bucket === "commission") line.commission += hold;
  else if (bucket === "logistics") line.logistics += hold;
  else if (bucket === "storage") line.storage += hold;
  else if (bucket === "ads") line.adsHold += hold;
  else if (bucket === "penalties") line.penalties += hold;
  else if (signed < 0) line.otherHold += hold;
  else line.credits = (line.credits ?? 0) + signed;
}

function feeAmount(fee: Fee | undefined): number {
  if (!fee) return 0;
  return num(fee.accrued) || num(fee.amount);
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

async function loadTypes(creds: ShopCreds): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const json = await ozonRequest<{ accrual_types?: AccrualType[] }>(creds, "/v1/finance/accrual/types", {});
    for (const t of json.accrual_types ?? []) {
      if (t.id == null) continue;
      map.set(Number(t.id), `${t.name ?? ""} ${t.description ?? ""}`.trim());
    }
  } catch {
    /* optional */
  }
  return map;
}

export async function fetchCashFlow(creds: ShopCreds, dateFrom: string, dateTo: string): Promise<CashFlowSummary | null> {
  try {
    const request = async (from: string, to: string) =>
      ozonRequest<{
        result?: {
          cash_flows?: {
            period?: { begin?: string; end?: string; from?: string; to?: string };
            orders_amount?: number;
          }[];
          details?: {
            invoice_transfer?: number;
            payments?: { payment?: number } | { payment?: number }[];
            period?: { begin?: string; end?: string; from?: string; to?: string };
            delivery?: { amount?: number; total?: number };
          };
          page_count?: number;
        };
      }>(creds, "/v1/finance/cash-flow-statement/list", {
        date: { from, to },
        page: 1,
        page_size: 50,
        with_details: true,
      });
    let json;
    try {
      json = await request(dateFrom, dateTo);
    } catch {
      json = await request(`${dateFrom}T00:00:00.000Z`, `${dateTo}T23:59:59.999Z`);
    }
    const periodStart = (p?: { begin?: string; end?: string; from?: string; to?: string }) =>
      dayOf(p?.begin || p?.from);
    const inRange = (start: string) => Boolean(start) && start >= dateFrom && start <= dateTo;

    const out: CashFlowSummary = { revenue: 0, payout: 0, paid: 0, periods: 0 };
    for (const f of json.result?.cash_flows ?? []) {
      const start = periodStart(f.period);
      if (!inRange(start)) continue;
      out.periods += 1;
      out.revenue += num(f.orders_amount);
    }
    const details = json.result?.details;
    if (details) {
      const start = periodStart(details.period);
      if (!start || inRange(start)) {
        out.payout += num(details.invoice_transfer);
        if (!out.revenue) out.revenue += num(details.delivery?.amount ?? details.delivery?.total);
      }
      for (const p of asArray(details.payments)) out.paid += Math.abs(num(p.payment));
    }
    if (!out.periods && !out.payout && !out.paid) return null;
    return out;
  } catch {
    return null;
  }
}

export async function fetchFinanceTransactions(
  creds: ShopCreds,
  dateFrom: string,
  dateTo: string,
): Promise<FinanceLine[]> {
  const types = await loadTypes(creds);
  const bucketOf = (id: unknown): Bucket => classifyName(types.get(Number(id)) ?? "");
  const map = new Map<string, FinanceLine>();

  const line = (day: string, sku: string, name = "") => {
    const key = `${day}|${sku}`;
    const row = map.get(key) ?? emptyLine(day, sku, name);
    if (name && !row.name) row.name = name;
    map.set(key, row);
    return row;
  };

  for (const day of eachDay(dateFrom, dateTo)) {
    let lastId = "";
    const seen = new Set<string>();
    for (let page = 0; page < 80; page += 1) {
      let json: { accruals?: ByDayAccrual[]; last_id?: string | number };
      try {
        json = await ozonRequest(creds, "/v1/finance/accrual/by-day", { date: day, last_id: lastId });
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : "";
        if (page > 0 && (msg.includes("token") || msg.includes("last_id") || msg.includes("invalid"))) break;
        throw err;
      }
      const rows = json.accruals ?? [];
      if (!rows.length) break;
      const pageKey = rows.map((r) => String(r.accrual_id ?? r.unit_number ?? "")).join("|");
      if (pageKey && seen.has(pageKey)) break;
      if (pageKey) seen.add(pageKey);

      for (const acc of rows) {
        const d = dayOf(acc.date, day);
        const products = acc.posting?.products ?? [];
        const primarySku = String(products[0]?.sku ?? "").trim();
        let attributed = 0;
        let touch = line(d, primarySku, String(products[0]?.name ?? ""));
        let goodsSale = 0;

        const add = (row: FinanceLine, bucket: Bucket, signed: number) => {
          if (!signed) return;
          applyBucket(row, bucket, signed);
          attributed += bucket === "sale" ? signed : -Math.abs(signed);
          touch = row;
        };

        for (const p of products) {
          const sku = String(p.sku ?? "").trim();
          const row = line(d, sku, String(p.name ?? ""));
          const sale = num(p.commission?.sale_amount);
          const comm = num(p.commission?.sale_commission ?? p.commission?.commission);
          const bonus = num(p.commission?.bonus) + num(p.commission?.coinvestment);
          const deliv = num(p.delivery?.total_accrued);
          if (sale) {
            add(row, "sale", sale);
            if (sale > 0) {
              goodsSale += sale;
              row.realization += sale;
              const qty = Number(p.quantity ?? 0);
              row.units += qty > 0 ? qty : 1;
            }
            if (sale < 0) {
              const qty = Number(p.quantity ?? 0);
              row.units -= qty > 0 ? qty : 1;
            }
          }
          if (comm) add(row, "commission", comm);
          if (bonus) {
            row.credits = (row.credits ?? 0) + bonus;
            attributed += bonus;
          }
          if (deliv) add(row, "logistics", deliv);
          else {
            for (const svc of p.delivery?.services ?? []) {
              const amt = feeAmount(svc);
              if (!amt) continue;
              const b = bucketOf(svc.type_id ?? svc.accrual_id);
              add(row, b === "other" || b === "sale" ? "logistics" : b, amt);
            }
          }
        }

        const groups = Array.isArray(acc.item_fees) ? acc.item_fees : (acc.item_fees?.fees ?? []);
        for (const group of groups) {
          const sku = String(group.sku ?? "").trim();
          const row = line(d, sku || primarySku);
          for (const fee of group.fees ?? []) {
            const amt = feeAmount(fee);
            if (!amt) continue;
            const b = bucketOf(fee.type_id ?? fee.accrual_id);
            if (b === "sale") {
              if (goodsSale > 0) continue;
              add(row, "sale", amt);
            } else {
              add(row, b, amt);
            }
          }
        }

        for (const fee of asArray(acc.non_item_fee)) {
          const amt = feeAmount(fee);
          if (!amt) continue;
          const b = bucketOf(fee.type_id ?? fee.accrual_id);
          if (b !== "sale") add(line(d, primarySku), b, amt);
        }
        const container = Array.isArray(acc.container_fees) ? acc.container_fees : (acc.container_fees?.fees ?? []);
        for (const fee of container) {
          const amt = feeAmount(fee);
          if (!amt) continue;
          const b = bucketOf(fee.type_id ?? fee.accrual_id);
          if (b !== "sale") add(line(d, primarySku), b, amt);
        }

        const total = num(acc.total_amount) || num(acc.accrued);
        const remainder = round2(total - attributed);
        if (remainder < 0) add(touch, "other", remainder);
        else if (remainder > 0) touch.credits = (touch.credits ?? 0) + remainder;
      }

      const next =
        json.last_id == null || json.last_id === "" || json.last_id === 0 || json.last_id === "0"
          ? ""
          : String(json.last_id).trim();
      if (!next || next === lastId) break;
      lastId = next;
    }
  }

  for (const row of map.values()) {
    const credits = row.credits ?? 0;
    const holds = row.commission + row.logistics + row.returns + row.storage + row.penalties + row.adsHold + row.otherHold;
    row.payout = round2(row.revenue - holds + credits);
    row.realization = round2(row.realization || row.revenue);
    row.revenue = round2(row.revenue);
    row.commission = round2(row.commission);
    row.logistics = round2(row.logistics);
    row.returns = round2(row.returns);
    row.storage = round2(row.storage);
    row.penalties = round2(row.penalties);
    row.adsHold = round2(row.adsHold);
    row.otherHold = round2(row.otherHold);
    row.realization = round2(row.realization);
  }
  return [...map.values()];
}
