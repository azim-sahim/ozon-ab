import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { listShops } from "@/lib/server/actions";
import { getProfitDashboard, saveFinanceSettings, saveSkuCost, syncFinance } from "@/lib/server/finance-actions";
import { TAX_REGIMES } from "@/lib/profit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { cn, formatMoney, formatPct } from "@/lib/utils";
import { toast } from "sonner";
import type { ProfitSkuRow } from "@/lib/types";

export const Route = createFileRoute("/_app/profit")({ component: ProfitPage });

type PeriodId = "today" | "yesterday" | "month" | "lastMonth";

function moscowToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
}

function ruDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

function signedClass(n: number): string {
  if (n > 0) return "text-ok";
  if (n < 0) return "text-danger";
  return "text-muted";
}

function ProfitPage() {
  const qc = useQueryClient();
  const today = moscowToday();
  const shops = useQuery({ queryKey: ["shops"], queryFn: () => listShops() });
  const [shopId, setShopId] = useState("");
  const [period, setPeriod] = useState<PeriodId>("lastMonth");
  const activeShop = shopId || shops.data?.[0]?.id || "";
  const shop = shops.data?.find((s) => s.id === activeShop);

  const dash = useQuery({
    queryKey: ["profit-dash", activeShop, today, period],
    queryFn: () => getProfitDashboard({ data: { shopId: activeShop, today, period } }),
    enabled: Boolean(activeShop),
  });

  const selected = dash.data?.periods.find((p) => p.id === period) ?? dash.data?.periods[3];

  const sync = useMutation({
    mutationFn: () =>
      syncFinance({
        data: { shopId: activeShop, from: dash.data?.rangeFrom ?? today, to: dash.data?.rangeTo ?? today },
      }),
    onSuccess: async (r) => {
      toast.success(`Собрано операций: ${r.rows}`);
      await qc.invalidateQueries({ queryKey: ["profit-dash"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [regime, setRegime] = useState("usn6");
  const [rate, setRate] = useState("6");
  const [extra, setExtra] = useState("0");
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!shop) return;
    setRegime(shop.taxRegime);
    setRate(String(shop.taxRate));
    setExtra(String(shop.extraMonthly));
  }, [shop?.id, shop?.taxRegime, shop?.taxRate, shop?.extraMonthly]);

  const saveTax = useMutation({
    mutationFn: () =>
      saveFinanceSettings({
        data: {
          shopId: activeShop,
          taxRegime: regime || shop?.taxRegime || "usn6",
          taxRate: Number(rate),
          extraMonthly: Number(extra),
        },
      }),
    onSuccess: async () => {
      toast.success("Налоги и расходы сохранены");
      await qc.invalidateQueries({ queryKey: ["shops"] });
      await qc.invalidateQueries({ queryKey: ["profit-dash"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [editSku, setEditSku] = useState<string | null>(null);
  const [cost, setCost] = useState("");
  const [pack, setPack] = useState("");
  const saveCost = useMutation({
    mutationFn: () =>
      saveSkuCost({
        data: {
          shopId: activeShop,
          sku: editSku ?? "",
          name: dash.data?.rows.find((r) => r.sku === editSku)?.name,
          cost: Number(cost),
          packing: Number(pack),
        },
      }),
    onSuccess: async () => {
      toast.success("Себестоимость записана");
      setEditSku(null);
      await qc.invalidateQueries({ queryKey: ["profit-dash"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const t = dash.data?.totals;
  const csv = useMemo(() => {
    const rows = dash.data?.rows ?? [];
    if (!rows.length || !t) return "";
    const head = ["SKU", "Товар", "Продано", "Продажи", "Возвраты", "Удержания", "Реклама", "Прибыль", "Маржа%", "ROI%", "ДРР%"];
    const line = (r: ProfitSkuRow) => {
      const holds = r.commission + r.logistics + r.returns + r.storage + r.penalties + r.otherHold;
      return [r.sku, r.name.replaceAll(";", ","), r.units, r.revenue, r.returns, holds, r.ads, r.profit, r.margin ?? "", r.roi ?? "", r.drr ?? ""].join(";");
    };
    return [head.join(";"), ...rows.map(line)].join("\n");
  }, [dash.data, t]);

  if (!shops.data?.length) {
    return (
      <Card className="space-y-3 p-8">
        <h1 className="text-2xl font-medium">Дашборд</h1>
        <p className="text-sm text-muted">Сначала подключите магазин Ozon.</p>
        <Link to="/shops">
          <Button>Магазины</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium tracking-tight">Дашборд</h1>
          <select
            className="h-9 rounded-[var(--radius-sm)] border border-border bg-elevated px-3 text-sm"
            value={activeShop}
            onChange={(e) => setShopId(e.target.value)}
          >
            {(shops.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setSettingsOpen((v) => !v)}>
            Налог и себестоимость
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `profit-${selected?.from ?? today}.csv`;
              a.click();
            }}
            disabled={!csv}
          >
            Excel / CSV
          </Button>
          <Button onClick={() => sync.mutate()} disabled={!activeShop || sync.isPending || !dash.data}>
            {sync.isPending ? "Сбор…" : "Собрать с Ozon"}
          </Button>
        </div>
      </div>

      {settingsOpen ? (
        <Card className="grid gap-3 p-4 sm:grid-cols-4">
          <div className="sm:col-span-4 text-sm text-muted">Налог считается с реализации (продажи − возвраты).</div>
          <div>
            <Label>Режим</Label>
            <select
              className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 text-sm"
              value={regime}
              onChange={(e) => {
                setRegime(e.target.value);
                const def = TAX_REGIMES.find((r) => r.id === e.target.value);
                if (def) setRate(String(def.rate));
              }}
            >
              {TAX_REGIMES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Ставка, %</Label>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <Label>Накладные в месяц, ₽</Label>
            <Input value={extra} onChange={(e) => setExtra(e.target.value)} inputMode="decimal" />
          </div>
          <div className="flex items-end">
            <Button onClick={() => saveTax.mutate()} disabled={saveTax.isPending}>
              Сохранить
            </Button>
          </div>
        </Card>
      ) : null}

      {dash.isLoading ? <p className="text-sm text-muted">Считаем…</p> : null}
      {dash.error ? <p className="text-sm text-danger">{(dash.error as Error).message}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(dash.data?.periods ?? []).map((p) => {
          const tot = p.totals;
          const active = p.id === period;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={cn(
                "overflow-hidden rounded-[var(--radius-xl)] border text-left transition",
                active ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/50",
              )}
            >
              <div className="bg-primary px-4 py-2.5 text-primary-fg">
                <p className="text-sm font-medium">{p.title}</p>
                <p className="text-xs opacity-80">
                  {p.from === p.to ? ruDate(p.from) : `${ruDate(p.from)} до ${ruDate(p.to)}`}
                </p>
              </div>
              <div className="space-y-3 bg-surface p-4">
                <div>
                  <p className="text-xs text-muted">Продажи</p>
                  <p className="text-lg font-medium tabular-nums">
                    {formatMoney(tot.revenue)}{" "}
                    <span className="text-sm font-normal text-muted">/ {tot.units} шт.</span>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted">Возвраты</p>
                    <p className="tabular-nums">{formatMoney(tot.returns)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Реклама</p>
                    <p className="tabular-nums">{formatMoney(tot.ads)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Сумма выплат</p>
                    <p className="tabular-nums">{formatMoney(tot.payout)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Прибыль</p>
                    <p className={`tabular-nums ${signedClass(tot.profit)}`}>{formatMoney(tot.profit)}</p>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {dash.data?.adsNote ? <p className="text-xs text-muted">{dash.data.adsNote}</p> : null}
      {dash.data?.missingCostCount ? (
        <p className="text-sm text-warn">
          Нет себестоимости у {dash.data.missingCostCount} SKU — нажмите сумму в колонке «Себест.».
        </p>
      ) : null}

      {dash.data && dash.data.rows.length === 0 ? (
        <Card className="space-y-2 p-8">
          <p className="text-lg">Нет операций за выбранный период</p>
          <p className="text-sm text-muted">Нажмите «Собрать с Ozon» — подтянем продажи, выплаты и рекламу за два месяца.</p>
        </Card>
      ) : null}

      {dash.data && dash.data.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-[var(--radius-xl)] border border-border">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-elevated text-xs uppercase tracking-wide text-subtle">
              <tr>
                {["Товар", "Продано", "Продажи", "Возвраты", "Удержания", "Реклама", "Прибыль", "На ед.", "Маржа", "ROI", "ДРР", "Себест."].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dash.data.rows.map((r) => {
                const holds = r.commission + r.logistics + r.returns + r.storage + r.penalties + r.otherHold;
                const perUnit = r.units ? r.profit / r.units : 0;
                const editing = editSku === r.sku;
                return (
                  <tr key={r.sku || r.name} className="border-t border-border hover:bg-elevated/40">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        {r.image ? (
                          <img src={r.image} alt="" className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] bg-elevated object-cover" />
                        ) : (
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-elevated text-[10px] text-subtle">
                            {r.sku ? (r.name || r.sku).charAt(0) : "—"}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="max-w-[18rem] truncate font-medium">{r.name}</p>
                          <p className="text-xs text-subtle">{r.sku || "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.units}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(r.revenue)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted">{formatMoney(r.returns)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted">{formatMoney(holds)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(r.ads)}</td>
                    <td className={`px-3 py-2 tabular-nums ${signedClass(r.profit)}`}>{formatMoney(r.profit)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(perUnit)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatPct(r.margin)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatPct(r.roi)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatPct(r.drr)}</td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <div className="flex flex-col gap-1">
                          <Input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="закупка" />
                          <Input value={pack} onChange={(e) => setPack(e.target.value)} placeholder="упаковка" />
                          <Button className="h-8" onClick={() => saveCost.mutate()}>
                            Ок
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="text-left tabular-nums text-muted hover:text-fg"
                          onClick={() => {
                            if (!r.sku) return;
                            setEditSku(r.sku);
                            setCost("");
                            setPack("");
                          }}
                        >
                          {r.missingCost ? "указать" : formatMoney(r.cogs)}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
