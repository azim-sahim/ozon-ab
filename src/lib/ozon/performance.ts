const BASES = ["https://api-performance.ozon.ru", "https://performance.ozon.ru"];

export type PerfCreds = { clientId: string; clientSecret: string };

export type AdsDay = {
  day: string;
  sku: string | null;
  views: number;
  clicks: number;
  carts: number;
  orders: number;
  spend: number;
  revenue: number;
};

export type AdsFetchResult = {
  status: "unconfigured" | "empty" | "ok" | "error";
  note: string;
  campaigns: number;
  rows: AdsDay[];
};

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").replace(/\s/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function money(v: unknown): number {
  const n = num(v);
  if (n === 0) return 0;
  if (Number.isInteger(n) && Math.abs(n) >= 100_000) return n / 1_000_000;
  return n;
}

function ymd(v: unknown, fallback: string): string {
  const s = String(v ?? "");
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : fallback;
}

async function token(creds: PerfCreds): Promise<{ token: string; host: string }> {
  let last = "Performance API не ответил";
  for (const host of BASES) {
    try {
      const res = await fetch(`${host}/api/client/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          grant_type: "client_credentials",
        }),
      });
      const text = await res.text();
      let json: { access_token?: string; message?: string } = {};
      try {
        json = text ? (JSON.parse(text) as typeof json) : {};
      } catch {
        json = {};
      }
      if (!res.ok || !json.access_token) {
        last = json.message || `Performance API ${res.status}`;
        continue;
      }
      return { token: json.access_token, host };
    } catch (err) {
      last = err instanceof Error ? err.message : last;
    }
  }
  throw new Error(
    last.toLowerCase().includes("client") || last.toLowerCase().includes("auth")
      ? "Ключи Performance API не приняты. Это не Seller Api-Key, а Client ID и Secret из раздела рекламы."
      : last,
  );
}

async function perfGet<T>(host: string, access: string, path: string): Promise<T> {
  const res = await fetch(`${host}${path}`, {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 240) || `Performance ${res.status}`);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { raw: text } as T;
  }
}

export async function validatePerfCredentials(creds: PerfCreds): Promise<void> {
  await token(creds);
}

type Campaign = { id?: string | number; campaignId?: string | number; state?: string };

function campaignIds(data: unknown): string[] {
  const bag =
    Array.isArray(data) ? data
    : data && typeof data === "object"
      ? ((data as { list?: Campaign[]; campaigns?: Campaign[]; result?: Campaign[] }).list
        ?? (data as { campaigns?: Campaign[] }).campaigns
        ?? (data as { result?: Campaign[] }).result
        ?? [])
      : [];
  const ids = new Set<string>();
  for (const c of bag) {
    const id = c?.id ?? c?.campaignId;
    if (id !== undefined && id !== null) ids.add(String(id));
  }
  return [...ids];
}

function parseRows(raw: unknown, fallbackDay: string): AdsDay[] {
  const list =
    Array.isArray(raw) ? raw
    : raw && typeof raw === "object"
      ? ((raw as { rows?: unknown[]; result?: unknown[]; data?: unknown[] }).rows
        ?? (raw as { result?: unknown[] }).result
        ?? (raw as { data?: unknown[] }).data
        ?? [])
      : [];
  const out: AdsDay[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    out.push({
      day: ymd(r.date ?? r.day ?? r.reportDate, fallbackDay),
      sku: r.sku !== undefined && r.sku !== null ? String(r.sku) : null,
      views: num(r.views ?? r.impressions ?? r.hits_view),
      clicks: num(r.clicks),
      carts: num(r.toCart ?? r.tocart ?? r.carts),
      orders: num(r.orders),
      spend: money(r.expense ?? r.moneySpent ?? r.spend),
      revenue: money(r.sales ?? r.revenue ?? r.modelSales),
    });
  }
  return out;
}

function parseCsv(raw: string, fallbackDay: string): AdsDay[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iSku = idx(["sku", "артикул"]);
  const iViews = idx(["показы", "views", "impression"]);
  const iClicks = idx(["клики", "clicks"]);
  const iCarts = idx(["корзин", "tocart", "to cart"]);
  const iOrders = idx(["заказы", "orders"]);
  const iSpend = idx(["расход", "expense", "spend"]);
  const iRev = idx(["выручка", "revenue", "sales"]);
  const iDate = idx(["дат", "date"]);
  const pick = (cols: string[], i: number) => (i >= 0 ? cols[i] : "");
  const out: AdsDay[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(delim);
    out.push({
      day: ymd(pick(cols, iDate), fallbackDay),
      sku: pick(cols, iSku) || null,
      views: num(pick(cols, iViews)),
      clicks: num(pick(cols, iClicks)),
      carts: num(pick(cols, iCarts)),
      orders: num(pick(cols, iOrders)),
      spend: money(pick(cols, iSpend)),
      revenue: money(pick(cols, iRev)),
    });
  }
  return out;
}

export async function fetchAdsStats(
  creds: PerfCreds,
  opts: { dateFrom: string; dateTo: string; skus: string[] },
): Promise<AdsFetchResult> {
  const skuSet = new Set(opts.skus.map(String));
  try {
    const { token: access, host } = await token(creds);
    const ids: string[] = [];
    for (let page = 1; page <= 15; page += 1) {
      const campaignsRaw = await perfGet<unknown>(host, access, `/api/client/campaign?page=${page}&pageSize=100`);
      const chunk = campaignIds(campaignsRaw);
      if (!chunk.length) break;
      ids.push(...chunk);
      if (chunk.length < 100) break;
    }
    const unique = [...new Set(ids)];
    if (!unique.length) {
      return {
        status: "empty",
        note: "В кабинете нет рекламных кампаний. По этому товару рекламной статистики нет.",
        campaigns: 0,
        rows: [],
      };
    }

    const collected: AdsDay[] = [];
    for (let i = 0; i < unique.length; i += 10) {
      const chunk = unique.slice(i, i + 10);
      const qs = chunk.map((id) => `campaignIds=${encodeURIComponent(id)}`).join("&");
      const query = `${qs}&dateFrom=${opts.dateFrom}&dateTo=${opts.dateTo}`;
      for (const path of [
        `/api/client/statistics/campaign/product/json?${query}`,
        `/api/client/statistics/campaign/product?${query}`,
        `/api/client/statistics/daily/json?${chunk.map((id) => `campaigns=${id}`).join("&")}&dateFrom=${opts.dateFrom}&dateTo=${opts.dateTo}`,
      ]) {
        try {
          const data = await perfGet<unknown>(host, access, path);
          if (data && typeof data === "object" && "raw" in (data as { raw?: string }) && typeof (data as { raw: string }).raw === "string") {
            collected.push(...parseCsv((data as { raw: string }).raw, opts.dateFrom));
          } else {
            collected.push(...parseRows(data, opts.dateFrom));
          }
          if (collected.length) break;
        } catch {
          /* try next path */
        }
      }
    }

    const matched = skuSet.size
      ? collected.filter((r) => !r.sku || skuSet.has(r.sku))
      : collected;
    const hasTraffic = matched.some((r) => r.views || r.clicks || r.orders || r.spend);
    if (!hasTraffic) {
      return {
        status: "empty",
        note: "На этом товаре нет рекламной статистики за период теста.",
        campaigns: unique.length,
        rows: [],
      };
    }
    return {
      status: "ok",
      note: `Реклама: ${unique.length} камп. · показы и клики Performance API`,
      campaigns: unique.length,
      rows: matched,
    };
  } catch (err) {
    return {
      status: "error",
      note: err instanceof Error ? err.message : "Ошибка Performance API",
      campaigns: 0,
      rows: [],
    };
  }
}

export function emptyAds(): AdsDay {
  return { day: "", sku: null, views: 0, clicks: 0, carts: 0, orders: 0, spend: 0, revenue: 0 };
}

export function addAds(a: AdsDay, b: AdsDay): AdsDay {
  return {
    day: a.day || b.day,
    sku: a.sku ?? b.sku,
    views: a.views + b.views,
    clicks: a.clicks + b.clicks,
    carts: a.carts + b.carts,
    orders: a.orders + b.orders,
    spend: a.spend + b.spend,
    revenue: a.revenue + b.revenue,
  };
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

export function allocateAds(
  rows: AdsDay[],
  days: string[],
  coverage: (day: string) => Map<string, number>,
): Map<string, Map<string, AdsDay>> {
  const out = new Map<string, Map<string, AdsDay>>();
  if (!days.length) return out;

  const inRange = rows.filter((r) => r.day && days.includes(r.day));
  const distinct = new Set(inRange.map((r) => r.day));
  const hasTraffic = rows.some((r) => r.views || r.clicks || r.orders || r.spend);
  const periodTotal = hasTraffic && (distinct.size <= 1 && days.length > 1 || inRange.length === 0);

  const variantCoverage = new Map<string, number>();
  for (const day of days) {
    for (const [id, ms] of coverage(day)) {
      variantCoverage.set(id, (variantCoverage.get(id) ?? 0) + ms);
    }
  }

  if (periodTotal) {
    const total = rows.reduce((a, b) => addAds(a, b), emptyAds());
    const byVar = splitAds(total, variantCoverage);
    for (const day of days) {
      const c = coverage(day);
      const dayMap = new Map<string, AdsDay>();
      for (const [vid, ads] of byVar) {
        const vTot = variantCoverage.get(vid) ?? 0;
        const share = vTot > 0 ? (c.get(vid) ?? 0) / vTot : 0;
        dayMap.set(vid, {
          day,
          sku: ads.sku,
          views: Math.round(ads.views * share),
          clicks: Math.round(ads.clicks * share),
          carts: Math.round(ads.carts * share),
          orders: Math.round(ads.orders * share),
          spend: ads.spend * share,
          revenue: ads.revenue * share,
        });
      }
      out.set(day, dayMap);
    }
    return out;
  }

  const byDay = new Map<string, AdsDay>();
  for (const r of inRange) {
    byDay.set(r.day, addAds(byDay.get(r.day) ?? { ...emptyAds(), day: r.day }, r));
  }
  for (const day of days) {
    out.set(day, splitAds(byDay.get(day) ?? { ...emptyAds(), day }, coverage(day)));
  }
  return out;
}

export function splitAds(row: AdsDay, weights: Map<string, number>): Map<string, AdsDay> {
  const views = splitInt(row.views, weights);
  const clicks = splitInt(row.clicks, weights);
  const carts = splitInt(row.carts, weights);
  const orders = splitInt(row.orders, weights);
  const sumW = [...weights.values()].reduce((s, n) => s + n, 0);
  const out = new Map<string, AdsDay>();
  for (const k of weights.keys()) {
    const w = sumW > 0 ? (weights.get(k) ?? 0) / sumW : 0;
    out.set(k, {
      day: row.day,
      sku: row.sku,
      views: views.get(k) ?? 0,
      clicks: clicks.get(k) ?? 0,
      carts: carts.get(k) ?? 0,
      orders: orders.get(k) ?? 0,
      spend: row.spend * w,
      revenue: row.revenue * w,
    });
  }
  return out;
}
