import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { computeSignificance, computeStats } from "@/lib/stats";
import { demoDaily, DEMO_PRODUCTS, filterDemoProducts } from "@/lib/ozon/demo";
import {
  addFunnel,
  coveragesForDay,
  eachDay,
  emptyFunnel,
  moscowYmd,
  sanitizeFunnel,
  splitFunnel,
} from "@/lib/metrics";
import {
  applyNameDescription,
  applyPictures,
  applyPrices,
  fetchAnalytics,
  fetchOrderMetrics,
  getProductDetails,
  listProducts,
  validateCredentials,
  type ShopCreds,
} from "@/lib/ozon/client";
import type { AdsSummary, ProductCard, RotationMode, TestDetail, TestMode } from "@/lib/types";
import { addHours, asIso, mapLog, mapMetric, mapShop, mapTest, mapVariant } from "./map";
import { allocateAds, emptyAds, fetchAdsStats, splitAds, validatePerfCredentials, type AdsDay, type PerfCreds } from "@/lib/ozon/performance";
import { publicMediaUrl, publicOrigin, saveMedia } from "@/lib/server/media";

function nid() {
  return crypto.randomUUID();
}

async function writeLog(
  userId: string,
  rec: { shopId?: string | null; testId?: string | null; productId?: string | null; action: string; detail?: string },
) {
  const sql = await getSql();
  await sql`insert into change_logs (id, user_id, shop_id, test_id, product_id, action, detail)
    values (${nid()}, ${userId}, ${rec.shopId ?? null}, ${rec.testId ?? null}, ${rec.productId ?? null}, ${rec.action}, ${rec.detail ?? null})`;
}

async function shopRow(userId: string, shopId: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    is_demo: boolean;
    client_id_enc: string | null;
    api_key_enc: string | null;
    perf_client_id_enc: string | null;
    perf_client_secret_enc: string | null;
    created_at: unknown;
  }>`select * from shops where id = ${shopId} and user_id = ${userId}`;
  if (!rows[0]) throw new Error("Магазин не найден");
  return rows[0];
}

export async function credsFor(userId: string, shopId: string): Promise<{
  demo: boolean;
  creds?: ShopCreds;
  perf?: PerfCreds;
  name: string;
}> {
  const row = await shopRow(userId, shopId);
  const demo = row.is_demo === true || row.is_demo === ("t" as unknown as boolean);
  if (demo) return { demo: true, name: row.name };
  if (!row.client_id_enc || !row.api_key_enc) {
    throw new Error("У магазина нет ключей Ozon. Откройте «Магазины» и сохраните Client-Id и Api-Key.");
  }
  try {
    const { decryptSecret } = await import("./secrets");
    const perf =
      row.perf_client_id_enc && row.perf_client_secret_enc
        ? {
            clientId: decryptSecret(row.perf_client_id_enc),
            clientSecret: decryptSecret(row.perf_client_secret_enc),
          }
        : undefined;
    return {
      demo: false,
      name: row.name,
      creds: {
        clientId: decryptSecret(row.client_id_enc),
        apiKey: decryptSecret(row.api_key_enc),
      },
      perf,
    };
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Ключи магазина не читаются. Пересохраните их в «Магазины».");
  }
}

export const listShops = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<Parameters<typeof mapShop>[0]>`
      select id, name, is_demo, client_id_enc, perf_client_id_enc, tax_regime, tax_rate, extra_monthly, created_at from shops where user_id = ${context.userId} order by created_at desc`;
    return rows.map(mapShop);
  });

export const saveShop = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: string; name: string; clientId?: string; apiKey?: string; perfClientId?: string; perfClientSecret?: string; demo?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const name = data.name.trim();
    if (!name) throw new Error("Укажите название магазина");
    if (data.demo) {
      const id = nid();
      await sql`insert into shops (id, user_id, name, is_demo) values (${id}, ${context.userId}, ${name}, ${true})`;
      await writeLog(context.userId, { shopId: id, action: "shop_created", detail: `Демо «${name}»` });
      return { id };
    }
    const clientId = data.clientId?.trim() ?? "";
    const apiKey = data.apiKey?.trim() ?? "";
    const perfClientId = data.perfClientId?.trim() ?? "";
    const perfClientSecret = data.perfClientSecret?.trim() ?? "";
    if (!data.id && (!clientId || !apiKey)) throw new Error("Нужны Client-Id и Api-Key Seller API");
    if (data.id && (clientId || apiKey) && (!clientId || !apiKey)) {
      throw new Error("Чтобы обновить ключи Seller API, вставьте и Client-Id, и Api-Key");
    }
    if (perfClientId || perfClientSecret) {
      if (!perfClientId || !perfClientSecret) throw new Error("Для рекламы нужны оба поля: Performance Client ID и Client Secret");
      await validatePerfCredentials({ clientId: perfClientId, clientSecret: perfClientSecret });
    }
    if (clientId && apiKey) await validateCredentials({ clientId, apiKey });
    const { encryptSecret, hintClientId } = await import("./secrets");
    if (data.id) {
      const existing = await shopRow(context.userId, data.id);
      const nextClient = clientId ? encryptSecret(clientId) : existing.client_id_enc;
      const nextKey = apiKey ? encryptSecret(apiKey) : existing.api_key_enc;
      const nextPerfId = perfClientId ? encryptSecret(perfClientId) : existing.perf_client_id_enc;
      const nextPerfSec = perfClientSecret ? encryptSecret(perfClientSecret) : existing.perf_client_secret_enc;
      await sql`update shops set name = ${name}, client_id_enc = ${nextClient}, api_key_enc = ${nextKey},
        perf_client_id_enc = ${nextPerfId}, perf_client_secret_enc = ${nextPerfSec}
        where id = ${data.id} and user_id = ${context.userId}`;
      return { id: data.id };
    }
    const id = nid();
    await sql`insert into shops (id, user_id, name, client_id_enc, api_key_enc, perf_client_id_enc, perf_client_secret_enc, is_demo)
      values (${id}, ${context.userId}, ${name}, ${encryptSecret(clientId)}, ${encryptSecret(apiKey)},
        ${perfClientId ? encryptSecret(perfClientId) : null}, ${perfClientSecret ? encryptSecret(perfClientSecret) : null}, ${false})`;
    await writeLog(context.userId, { shopId: id, action: "shop_created", detail: `Client-Id ${hintClientId(clientId)}` });
    return { id };
  });

export const deleteShop = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from metrics_daily where test_id in (select id from tests where shop_id = ${id} and user_id = ${context.userId})`;
    await sql`delete from test_periods where test_id in (select id from tests where shop_id = ${id} and user_id = ${context.userId})`;
    await sql`delete from variants where test_id in (select id from tests where shop_id = ${id} and user_id = ${context.userId})`;
    await sql`delete from tests where shop_id = ${id} and user_id = ${context.userId}`;
    await sql`delete from shops where id = ${id} and user_id = ${context.userId}`;
  });

export const searchProducts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { shopId: string; query?: string }) => d)
  .handler(async ({ context, data }) => {
    const shop = await credsFor(context.userId, data.shopId);
    if (shop.demo) return filterDemoProducts(data.query);
    return listProducts(shop.creds!, data.query);
  });

export const loadProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { shopId: string; productId: string }) => d)
  .handler(async ({ context, data }) => {
    const shop = await credsFor(context.userId, data.shopId);
    if (shop.demo) {
      const p = DEMO_PRODUCTS.find((x) => x.productId === data.productId);
      if (!p) throw new Error("Товар не найден");
      return p;
    }
    return getProductDetails(shop.creds!, data.productId);
  });

type CreateTestInput = {
  shopId: string;
  name: string;
  product: ProductCard;
  mode: TestMode;
  rotation: RotationMode;
  intervalHours: number;
  variants: { label: string; title: string; description: string; images: string[]; price: string | null; isControl?: boolean }[];
};

export const createTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: CreateTestInput) => d)
  .handler(async ({ context, data }) => {
    if (data.variants.length < 2) throw new Error("Нужны минимум два варианта");
    await shopRow(context.userId, data.shopId);
    const sql = await getSql();
    const id = nid();
    const hours = Math.max(1, Number(data.intervalHours) || 1);
    await sql`insert into tests (id, user_id, shop_id, name, product_id, offer_id, sku, product_name, product_image, snapshot, status, mode, rotation, interval_hours)
      values (${id}, ${context.userId}, ${data.shopId}, ${data.name.trim() || data.product.name}, ${data.product.productId}, ${data.product.offerId}, ${data.product.sku},
        ${data.product.name}, ${data.product.images[0] ?? null}, ${JSON.stringify(data.product)}::jsonb, ${"draft"}, ${data.mode}, ${data.rotation}, ${hours})`;
    let controlId: string | null = null;
    for (const [i, v] of data.variants.entries()) {
      const vid = nid();
      const isControl = Boolean(v.isControl) || i === 0;
      if (isControl) controlId = vid;
      await sql`insert into variants (id, test_id, user_id, label, is_control, title, description, images, price, sort_order)
        values (${vid}, ${id}, ${context.userId}, ${v.label || String.fromCharCode(65 + i)}, ${isControl}, ${v.title}, ${v.description}, ${JSON.stringify(v.images)}::jsonb, ${v.price}, ${i})`;
    }
    if (controlId) await sql`update tests set control_variant_id = ${controlId} where id = ${id}`;
    await writeLog(context.userId, { shopId: data.shopId, testId: id, productId: data.product.productId, action: "test_created" });
    return { id };
  });

export const uploadMedia = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { filename: string; mime: string; dataBase64: string; origin: string }) => d)
  .handler(async ({ context, data }) => {
    const saved = await saveMedia({
      userId: context.userId,
      filename: data.filename,
      mime: data.mime,
      dataBase64: data.dataBase64,
    });
    const origin = publicOrigin(data.origin);
    if (!origin) throw new Error("Неизвестный адрес сайта. Задайте APP_URL.");
    return { id: saved.id, url: publicMediaUrl(origin, saved.id, saved.mime) };
  });

export const updateVariantImages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { testId: string; variantId: string; images: string[] }) => d)
  .handler(async ({ context, data }) => {
    const images = data.images.map((u) => u.trim()).filter(Boolean);
    if (!images.length) throw new Error("Нужна хотя бы одна картинка");
    const detail = await loadTestDetail(context.userId, data.testId);
    const variant = detail.variants.find((v) => v.id === data.variantId);
    if (!variant) throw new Error("Вариант не найден");
    const sql = await getSql();
    await sql`update variants set images = ${JSON.stringify(images)}::jsonb
      where id = ${data.variantId} and test_id = ${data.testId}`;
    if (variant.isControl || data.variantId === detail.test.currentVariantId) {
      await sql`update tests set product_image = ${images[0]} where id = ${data.testId} and user_id = ${context.userId}`;
    }
    await writeLog(context.userId, { testId: data.testId, action: "images_updated", detail: `Вариант ${variant.label}: ${images.length} фото` });
    if (detail.test.status === "running" && detail.test.mode !== "analysis_only" && data.variantId === detail.test.currentVariantId) {
      const product = detail.snapshot ?? (await snapshotOf(data.testId));
      await applyVariantToOzon(context.userId, detail.test.shopId, product, { ...variant, images }, data.testId, liveFromVariant(variant));
    }
    return loadTestDetail(context.userId, data.testId);
  });

export const listTests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<Parameters<typeof mapTest>[0]>`
      select t.*, s.name as shop_name, v.label as current_label,
        (select count(*) from variants vv where vv.test_id = t.id) as variant_count
      from tests t
      join shops s on s.id = t.shop_id
      left join variants v on v.id = t.current_variant_id
      where t.user_id = ${context.userId}
      order by t.created_at desc`;
    return rows.map(mapTest);
  });

async function loadTestDetail(userId: string, testId: string): Promise<TestDetail> {
  const sql = await getSql();
  const tests = await sql<Parameters<typeof mapTest>[0] & { snapshot: unknown; perf_client_id_enc: string | null; shop_demo: boolean }>`
    select t.*, s.name as shop_name, s.perf_client_id_enc, s.is_demo as shop_demo, v.label as current_label
    from tests t join shops s on s.id = t.shop_id
    left join variants v on v.id = t.current_variant_id
    where t.id = ${testId} and t.user_id = ${userId}`;
  const row = tests[0];
  if (!row) throw new Error("Тест не найден");
  const variants = (await sql<Parameters<typeof mapVariant>[0]>`select * from variants where test_id = ${testId} order by sort_order`).map(mapVariant);
  const metrics = (
    await sql<Parameters<typeof mapMetric>[0]>`
      select m.*, v.label as variant_label from metrics_daily m
      join variants v on v.id = m.variant_id
      where m.test_id = ${testId} order by m.day`
  )
    .map(mapMetric)
    .map((m) => ({ ...m, ...sanitizeFunnel(m) }));
  const started = mapTest(row);
  started.variantCount = variants.length;
  const launchDay = started.startedAt ? moscowYmd(new Date(started.startedAt)) : null;
  const counted = launchDay ? metrics.filter((m) => m.day !== launchDay) : metrics;
  const stats = computeStats(variants, counted);
  const closedStats = computeStats(variants, counted.filter((m) => !m.incomplete));
  let snapshot: ProductCard | null = null;
  if (row.snapshot) snapshot = typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : (row.snapshot as ProductCard);
  const today = moscowYmd();
  const hasToday = counted.some((m) => m.day === today && (m.orderedUnits > 0 || m.hitsView > 0));
  let analyticsNote: string | null = launchDay ? "День запуска в подсчёт не входит." : null;
  if (hasToday) analyticsNote = `Сегодняшние заказы уже в карточке. Сутки ещё открыты — цифра может вырасти. В z-тест сегодняшний день не входит. ${analyticsNote ?? ""}`.trim();
  else if (started.status === "running" && !analyticsNote) {
    analyticsNote =
      "Сбор берёт заказы из отгрузок FBS/FBO, включая сегодня. Органические показы — Premium Plus. Рекламные показы — Performance API.";
  }
  return {
    test: started,
    variants,
    metrics: counted,
    stats,
    significance: computeSignificance(closedStats),
    snapshot,
    analyticsNote,
    ads: summarizeAds(counted, Boolean(row.perf_client_id_enc), Boolean(row.shop_demo)),
  };
}

function summarizeAds(metrics: { adsViews: number; adsClicks: number; adsCarts: number; adsOrders: number; adsSpend: number; adsRevenue: number }[], hasPerf: boolean, demo: boolean, override?: AdsSummary): AdsSummary {
  if (override) return override;
  const views = metrics.reduce((s, m) => s + m.adsViews, 0);
  const clicks = metrics.reduce((s, m) => s + m.adsClicks, 0);
  const carts = metrics.reduce((s, m) => s + m.adsCarts, 0);
  const orders = metrics.reduce((s, m) => s + m.adsOrders, 0);
  const spend = metrics.reduce((s, m) => s + m.adsSpend, 0);
  const revenue = metrics.reduce((s, m) => s + m.adsRevenue, 0);
  if (views || clicks || orders || spend) {
    return { status: "ok", note: demo ? "Демо-реклама" : "Рекламная статистика Performance API", campaigns: 1, views, clicks, carts, orders, spend, revenue, ctr: views > 0 ? clicks / views : 0 };
  }
  if (demo) {
    return { status: "empty", note: "Нажмите «Собрать метрики» — для демо появится пример рекламы.", campaigns: 0, views: 0, clicks: 0, carts: 0, orders: 0, spend: 0, revenue: 0, ctr: 0 };
  }
  if (!hasPerf) {
    return {
      status: "unconfigured",
      note: "Рекламная статистика не подключена. В магазине укажите Client ID и Client Secret Performance API — это не Seller Api-Key.",
      campaigns: 0, views: 0, clicks: 0, carts: 0, orders: 0, spend: 0, revenue: 0, ctr: 0,
    };
  }
  return {
    status: "empty",
    note: "На этом товаре нет рекламной статистики.",
    campaigns: 0, views: 0, clicks: 0, carts: 0, orders: 0, spend: 0, revenue: 0, ctr: 0,
  };
}

export const getTest = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const due = await sql<{ id: string }>`
      select id from tests where id = ${id} and user_id = ${context.userId}
        and status = ${"running"} and next_switch_at is not null and next_switch_at <= now()`;
    if (due[0]) {
      try {
        await rotateTest(context.userId, id);
      } catch {
        /* show the test even if Ozon is down */
      }
    }
    return loadTestDetail(context.userId, id);
  });

function normText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function sameImages(a: string[], b: string[]): boolean {
  const left = a.map((u) => u.trim()).filter(Boolean);
  const right = b.map((u) => u.trim()).filter(Boolean);
  return left.length === right.length && left.every((url, i) => url === right[i]);
}

type LiveCard = { title: string; description: string; images: string[] };

function liveFromVariant(v: { title: string; description: string; images: string[] }): LiveCard {
  return { title: v.title, description: v.description, images: v.images };
}

function liveFromProduct(p: ProductCard): LiveCard {
  return { title: p.name, description: p.description, images: p.images };
}

async function applyVariantToOzon(
  userId: string,
  shopId: string,
  product: ProductCard,
  variant: { title: string; description: string; images: string[]; price: string | null; label?: string },
  testId: string,
  live: LiveCard,
) {
  const shop = await credsFor(userId, shopId);
  const sql = await getSql();
  const preview = variant.images[0] ?? product.images[0] ?? null;
  if (preview) await sql`update tests set product_image = ${preview} where id = ${testId} and user_id = ${userId}`;
  if (shop.demo) {
    await writeLog(userId, { shopId, testId, productId: product.productId, action: "variant_applied_demo", detail: `Демо: ${variant.label}` });
    return;
  }
  const creds = shop.creds!;
  const notes: string[] = [];
  const errors: string[] = [];
  if (variant.images.length && !sameImages(variant.images, live.images)) {
    try {
      await applyPictures(creds, product.productId, variant.images);
      notes.push("изображения");
    } catch (err) {
      errors.push(`изображения: ${err instanceof Error ? err.message : "ошибка"}`);
    }
  }
  if (variant.price && variant.price !== product.price) {
    try {
      await applyPrices(creds, product.productId, variant.price);
      notes.push("цена");
    } catch (err) {
      errors.push(`цена: ${err instanceof Error ? err.message : "ошибка"}`);
    }
  }
  const titleChanged = Boolean(normText(variant.title)) && normText(variant.title) !== normText(live.title);
  const descriptionChanged = normText(variant.description) !== normText(live.description);
  if (titleChanged || descriptionChanged) {
    try {
      await applyNameDescription(creds, product, variant.title, variant.description, {
        title: titleChanged,
        description: descriptionChanged,
      });
      notes.push(titleChanged ? "название" : "описание");
    } catch (err) {
      errors.push(`название: ${err instanceof Error ? err.message : "ошибка"}`);
    }
  }
  await writeLog(userId, {
    shopId,
    testId,
    productId: product.productId,
    action: errors.length ? "variant_error" : "variant_applied",
    detail: `${variant.label ?? ""} · ${notes.join(", ") || "без изменений"}${errors.length ? ` · ${errors.join("; ")}` : ""}`,
  });
  if (errors.length && !notes.length) throw new Error(errors.join("; "));
}

async function snapshotOf(testId: string): Promise<ProductCard> {
  const sql = await getSql();
  const rows = await sql<{ snapshot: unknown }>`select snapshot from tests where id = ${testId}`;
  const raw = rows[0]?.snapshot;
  if (!raw) throw new Error("Нет снимка карточки");
  return typeof raw === "string" ? JSON.parse(raw) : (raw as ProductCard);
}

export async function rotateTest(userId: string, testId: string, forcedVariantId?: string) {
  const sql = await getSql();
  const detail = await loadTestDetail(userId, testId);
  if (detail.test.status !== "running" && !forcedVariantId) return { switched: 0 };
  const variants = detail.variants;
  const cur = detail.test.currentVariantId;
  const idx = Math.max(0, variants.findIndex((v) => v.id === cur));
  const next = forcedVariantId
    ? variants.find((v) => v.id === forcedVariantId)
    : variants[(idx + 1) % Math.max(1, variants.length)];
  if (!next) return { switched: 0 };
  const hours = Math.max(1, Number(detail.test.intervalHours) || 1);
  const nextAt = addHours(new Date(), hours);
  const claimed = forcedVariantId
    ? await sql<{ id: string }>`update tests set current_variant_id = ${next.id}, next_switch_at = ${nextAt.toISOString()}
        where id = ${testId} and user_id = ${userId} returning id`
    : await sql<{ id: string }>`update tests set current_variant_id = ${next.id}, next_switch_at = ${nextAt.toISOString()}
        where id = ${testId} and user_id = ${userId} and status = ${"running"}
          and next_switch_at is not null and next_switch_at <= now()
        returning id`;
  if (!claimed[0]) return { switched: 0 };

  await sql`update test_periods set ended_at = now() where test_id = ${testId} and ended_at is null`;
  await sql`insert into test_periods (id, test_id, user_id, variant_id, started_at)
    values (${nid()}, ${testId}, ${userId}, ${next.id}, now())`;

  if (detail.test.mode !== "analysis_only") {
    try {
      const product = detail.snapshot ?? (await snapshotOf(testId));
      const current = variants.find((v) => v.id === cur);
      await applyVariantToOzon(userId, detail.test.shopId, product, next, testId, current ? liveFromVariant(current) : liveFromProduct(product));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ozon не принял карточку";
      await writeLog(userId, {
        testId,
        shopId: detail.test.shopId,
        action: "autoswitch_ozon_error",
        detail: message,
      });
      // Ручная смена («Поставить на карточку») — пользователь должен увидеть ошибку.
      if (forcedVariantId) throw new Error(message);
    }
  }
  await writeLog(userId, { testId, shopId: detail.test.shopId, action: "autoswitch", detail: `Автосмена → ${next.label}` });
  return { switched: 1 };
}

export const startTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const detail = await loadTestDetail(context.userId, id);
    const first = detail.variants.find((v) => v.isControl) ?? detail.variants[0];
    const sql = await getSql();
    const nextAt = addHours(new Date(), detail.test.intervalHours);
    await sql`update tests set status = ${"running"}, started_at = coalesce(started_at, now()), current_variant_id = ${first.id}, next_switch_at = ${nextAt.toISOString()}
      where id = ${id} and user_id = ${context.userId}`;
    await sql`insert into test_periods (id, test_id, user_id, variant_id, started_at) values (${nid()}, ${id}, ${context.userId}, ${first.id}, now())`;
    if (detail.test.mode !== "analysis_only") {
      const product = detail.snapshot ?? (await snapshotOf(id));
      const current = detail.variants.find((v) => v.id === detail.test.currentVariantId);
      await applyVariantToOzon(
        context.userId,
        detail.test.shopId,
        product,
        first,
        id,
        current ? liveFromVariant(current) : liveFromProduct(product),
      );
    }
    await writeLog(context.userId, { testId: id, action: "test_started", detail: `Старт ${first.label}` });
    return loadTestDetail(context.userId, id);
  });

export const pauseTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`update tests set status = ${"paused"}, next_switch_at = null where id = ${id} and user_id = ${context.userId}`;
    await writeLog(context.userId, { testId: id, action: "test_paused" });
    return loadTestDetail(context.userId, id);
  });

export const stopTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; restore: boolean }) => d)
  .handler(async ({ context, data }) => {
    const detail = await loadTestDetail(context.userId, data.id);
    const sql = await getSql();
    await sql`update test_periods set ended_at = now() where test_id = ${data.id} and ended_at is null`;
    await sql`update tests set status = ${"completed"}, completed_at = now(), next_switch_at = null where id = ${data.id} and user_id = ${context.userId}`;
    if (data.restore && detail.snapshot && detail.test.mode !== "analysis_only") {
      const current = detail.variants.find((v) => v.id === detail.test.currentVariantId);
      await applyVariantToOzon(context.userId, detail.test.shopId, detail.snapshot, {
        title: detail.snapshot.name,
        description: detail.snapshot.description,
        images: detail.snapshot.images,
        price: detail.snapshot.price,
        label: "оригинал",
      }, data.id, current ? liveFromVariant(current) : liveFromProduct(detail.snapshot));
    }
    await writeLog(context.userId, { testId: data.id, action: "test_stopped" });
    return loadTestDetail(context.userId, data.id);
  });

export const switchVariantNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { testId: string; variantId?: string }) => d)
  .handler(async ({ context, data }) => {
    await rotateTest(context.userId, data.testId, data.variantId);
    return loadTestDetail(context.userId, data.testId);
  });

export const updateTestSchedule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { testId: string; intervalHours: number; rotation: RotationMode }) => d)
  .handler(async ({ context, data }) => {
    const hours = Math.max(1, Number(data.intervalHours) || 1);
    const sql = await getSql();
    const nextAt = addHours(new Date(), hours);
    await sql`update tests set interval_hours = ${hours}, rotation = ${data.rotation}, next_switch_at = ${nextAt.toISOString()}
      where id = ${data.testId} and user_id = ${context.userId} and status = ${"running"}`;
    await sql`update tests set interval_hours = ${hours}, rotation = ${data.rotation}
      where id = ${data.testId} and user_id = ${context.userId} and status <> ${"running"}`;
    return loadTestDetail(context.userId, data.testId);
  });

export const applyWinner = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { testId: string; variantId: string }) => d)
  .handler(async ({ context, data }) => {
    const detail = await loadTestDetail(context.userId, data.testId);
    const winner = detail.variants.find((v) => v.id === data.variantId);
    if (!winner) throw new Error("Вариант не найден");
    const product = detail.snapshot ?? (await snapshotOf(data.testId));
    const current = detail.variants.find((v) => v.id === detail.test.currentVariantId);
    await applyVariantToOzon(
      context.userId,
      detail.test.shopId,
      product,
      winner,
      data.testId,
      current ? liveFromVariant(current) : liveFromProduct(product),
    );
    const sql = await getSql();
    await sql`update tests set winner_id = ${winner.id}, status = ${"completed"}, completed_at = now(), next_switch_at = null
      where id = ${data.testId} and user_id = ${context.userId}`;
    return loadTestDetail(context.userId, data.testId);
  });

export const deleteTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from metrics_daily where test_id in (select id from tests where id = ${data.id} and user_id = ${context.userId})`;
    await sql`delete from test_periods where test_id in (select id from tests where id = ${data.id} and user_id = ${context.userId})`;
    await sql`delete from variants where test_id in (select id from tests where id = ${data.id} and user_id = ${context.userId})`;
    await sql`delete from tests where id = ${data.id} and user_id = ${context.userId}`;
  });

type PeriodRow = { variant_id: string; started_at: unknown; ended_at: unknown };

async function upsertMetric(
  testId: string,
  variantId: string,
  day: string,
  m: { hitsView: number; sessionView: number; hitsTocart: number; orderedUnits: number; revenue: number },
  incomplete: boolean,
  ads: AdsDay = emptyAds(),
) {
  const sql = await getSql();
  await sql`insert into metrics_daily (id, test_id, variant_id, day, hits_view, session_view, hits_tocart, ordered_units, revenue, incomplete,
      ads_views, ads_clicks, ads_carts, ads_orders, ads_spend, ads_revenue)
    values (${nid()}, ${testId}, ${variantId}, ${day}, ${m.hitsView}, ${m.sessionView}, ${m.hitsTocart}, ${m.orderedUnits}, ${m.revenue}, ${incomplete},
      ${ads.views}, ${ads.clicks}, ${ads.carts}, ${ads.orders}, ${ads.spend}, ${ads.revenue})
    on conflict (test_id, variant_id, day) do update set
      hits_view = excluded.hits_view, session_view = excluded.session_view, hits_tocart = excluded.hits_tocart,
      ordered_units = excluded.ordered_units, revenue = excluded.revenue, incomplete = excluded.incomplete, fetched_at = now(),
      ads_views = excluded.ads_views, ads_clicks = excluded.ads_clicks, ads_carts = excluded.ads_carts,
      ads_orders = excluded.ads_orders, ads_spend = excluded.ads_spend, ads_revenue = excluded.ads_revenue`;
}

async function collectMetricsForTest(userId: string, testId: string): Promise<string> {
  const detail = await loadTestDetail(userId, testId);
  const shop = await credsFor(userId, detail.test.shopId);
  const sql = await getSql();
  let periods = await sql<PeriodRow>`select variant_id, started_at, ended_at from test_periods where test_id = ${testId}`;
  if (!periods.length && detail.test.currentVariantId) {
    const started = detail.test.startedAt ?? new Date().toISOString();
    await sql`insert into test_periods (id, test_id, variant_id, started_at) values (${nid()}, ${testId}, ${detail.test.currentVariantId}, ${started})`;
    periods = await sql<PeriodRow>`select variant_id, started_at, ended_at from test_periods where test_id = ${testId}`;
  }
  const startDay = detail.test.startedAt ? moscowYmd(new Date(detail.test.startedAt)) : moscowYmd();
  const today = moscowYmd();
  const days = eachDay(startDay, today).filter((day) => day !== startDay && coveragesForDay(periods, day).size > 0);
  if (!days.length) {
    const message = "День запуска в подсчёт не входит. Цифры появятся со следующих суток.";
    await writeLog(userId, { testId, action: "metrics_collected", detail: message });
    return message;
  }

  if (shop.demo) {
    await sql`delete from metrics_daily where test_id = ${testId}`;
    let written = 0;
    for (const [i, day] of days.entries()) {
      const weights = coveragesForDay(periods, day);
      const funnel = demoDaily("A", i, 5);
      if (day === today) funnel.orderedUnits = Math.max(1, funnel.orderedUnits);
      const adsTotal: AdsDay = {
        day,
        sku: detail.test.sku,
        views: Math.round(funnel.hitsView * 1.4),
        clicks: Math.max(1, Math.round(funnel.hitsView * 0.08)),
        carts: funnel.hitsTocart,
        orders: funnel.orderedUnits,
        spend: funnel.orderedUnits * 42,
        revenue: funnel.revenue,
      };
      const parts = splitFunnel(sanitizeFunnel(funnel), weights);
      const adsParts = splitAds(adsTotal, weights);
      for (const [variantId, part] of parts) {
        await upsertMetric(testId, variantId, day, sanitizeFunnel(part), day === today, adsParts.get(variantId) ?? emptyAds());
        written += 1;
      }
    }
    return `Демо: записано ${written} дн., включая сегодня. Реклама — пример Performance API.`;
  }

  let skus = [...new Set([detail.test.sku, detail.snapshot?.sku, ...(detail.snapshot?.skus ?? [])].filter((s): s is string => Boolean(s)))];
  if (!skus.length && detail.test.productId) {
    try {
      const fresh = await getProductDetails(shop.creds!, detail.test.productId);
      skus = fresh.skus.length ? fresh.skus : fresh.sku ? [fresh.sku] : [];
      if (fresh.sku) await sql`update tests set sku = ${fresh.sku} where id = ${testId}`;
    } catch {
      /* */
    }
  }

  const from = days[0];
  const to = today;
  const merged = new Map<string, ReturnType<typeof emptyFunnel>>();
  let note: string | null = null;
  try {
    const analytics = await fetchAnalytics(shop.creds!, { dateFrom: from, dateTo: to, skus });
    note = analytics.note;
    for (const row of analytics.rows) {
      if (!days.includes(row.day)) continue;
      merged.set(row.day, addFunnel(merged.get(row.day) ?? emptyFunnel(), row));
    }
    if (!analytics.rateLimited) {
      const orders = await fetchOrderMetrics(shop.creds!, {
        dateFrom: from,
        dateTo: to,
        skus,
        offerId: detail.test.offerId,
      });
      for (const row of orders) {
        if (!days.includes(row.day)) continue;
        const prev = merged.get(row.day) ?? emptyFunnel();
        if (row.orderedUnits > 0) prev.orderedUnits = row.orderedUnits;
        if (row.revenue > 0) prev.revenue = row.revenue;
        merged.set(row.day, prev);
      }
    }
  } catch (err) {
    note = err instanceof Error ? err.message : "Ошибка аналитики";
  }

  const adsRows: AdsDay[] = [];
  let adsNote = "";
  if (shop.perf) {
    const ads = await fetchAdsStats(shop.perf, { dateFrom: from, dateTo: to, skus });
    adsNote = ads.note;
    adsRows.push(...ads.rows);
  } else {
    adsNote = "Рекламная статистика не подключена. В магазине укажите Client ID и Secret Performance API.";
  }
  const adsAllocated = allocateAds(adsRows, days, (day) => coveragesForDay(periods, day));

  await sql`delete from metrics_daily where test_id = ${testId}`;
  let written = 0;
  let todayOrders = 0;
  for (const day of days) {
    const weights = coveragesForDay(periods, day);
    if (!weights.size) continue;
    const raw = sanitizeFunnel(merged.get(day) ?? emptyFunnel());
    if (day === today) todayOrders += raw.orderedUnits;
    const parts = splitFunnel(raw, weights);
    const adsParts = adsAllocated.get(day) ?? new Map();
    for (const [variantId, funnel] of parts) {
      const m = sanitizeFunnel(funnel);
      const ads = adsParts.get(variantId) ?? emptyAds();
      if (m.hitsView === 0 && m.hitsTocart === 0 && m.orderedUnits === 0 && m.revenue === 0 && ads.views === 0 && ads.clicks === 0 && ads.orders === 0 && ads.spend === 0) continue;
      await upsertMetric(testId, variantId, day, m, day === today, ads);
      written += 1;
    }
  }
  const message =
    todayOrders > 0
      ? `Сегодня: ${todayOrders} шт. (сутки открыты). Всего строк: ${written}.${note ? ` ${note}` : ""} ${adsNote}`
      : written
        ? `Записано ${written} строк за ${days.length} дн. Сегодняшних заказов в отгрузках нет.${note ? ` ${note}` : ""} ${adsNote}`
        : `Ozon не нашёл заказов с ${from} по ${to} по SKU/offer_id. ${note ?? ""} ${adsNote}`;
  await writeLog(userId, { testId, action: written ? "metrics_collected" : "metrics_error", detail: message });
  return message;
}

export const collectMetrics = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((testId: string) => testId)
  .handler(async ({ context, data: testId }) => {
    const collectMessage = await collectMetricsForTest(context.userId, testId);
    const detail = await loadTestDetail(context.userId, testId);
    return { ...detail, collectMessage, analyticsNote: collectMessage };
  });

export const listLogs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<Parameters<typeof mapLog>[0]>`
      select id, shop_id, test_id, product_id, action, detail, created_at
      from change_logs where user_id = ${context.userId} order by created_at desc limit 80`;
    return rows.map(mapLog);
  });

export async function runDueRotations() {
  const sql = await getSql();
  const due = await sql<{ id: string; user_id: string }>`
    select id, user_id from tests where status = ${"running"} and next_switch_at is not null and next_switch_at <= now()`;
  let switched = 0;
  for (const t of due) {
    try {
      const r = await rotateTest(t.user_id, t.id);
      switched += r.switched;
    } catch (err) {
      await writeLog(t.user_id, {
        testId: t.id,
        action: "autoswitch_failed",
        detail: err instanceof Error ? err.message : "ошибка автосмены",
      });
    }
  }
  await sql`insert into scheduler_state (id, last_run_at, last_switched, last_checked, detail)
    values (${"main"}, now(), ${switched}, ${due.length}, ${`due ${due.length}, switched ${switched}`})
    on conflict (id) do update set last_run_at = now(), last_switched = ${switched}, last_checked = ${due.length}, detail = excluded.detail`;
  return { checked: due.length, switched };
}

export const tickScheduler = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => runDueRotations());

export const getSchedulerStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    let ran = { checked: 0, switched: 0 };
    try {
      ran = await runDueRotations();
    } catch {
      /* status still useful */
    }
    const sql = await getSql();
    const rows = await sql<{ last_run_at: unknown; last_switched: number; last_checked: number; detail: string | null }>`
      select last_run_at, last_switched, last_checked, detail from scheduler_state where id = ${"main"}`;
    const row = rows[0];
    return {
      lastRunAt: row?.last_run_at ? asIso(row.last_run_at) : new Date().toISOString(),
      lastChecked: Number(row?.last_checked ?? ran.checked),
      lastSwitched: Number(row?.last_switched ?? ran.switched),
      detail: row?.detail ?? null,
    };
  });
