import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  applyWinner,
  collectMetrics,
  deleteTest,
  getSchedulerStatus,
  getTest,
  pauseTest,
  startTest,
  stopTest,
  switchVariantNow,
  updateTestSchedule,
  updateVariantImages,
} from "@/lib/server/actions";
import type { RotationMode } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { ImageGallery } from "@/components/image-gallery";
import { formatCtr, formatDate, formatRemaining } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/tests/$id")({ component: TestPage });

function TestPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["test", id], queryFn: () => getTest({ data: id }), refetchInterval: 15000 });
  const sched = useQuery({
    queryKey: ["sched"],
    queryFn: async () => {
      const s = await getSchedulerStatus();
      if (s.lastSwitched > 0) void qc.invalidateQueries({ queryKey: ["test"] });
      return s;
    },
    refetchInterval: 15000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["test", id] });
  const run = useMutation({
    mutationFn: () => startTest({ data: id }),
    onSuccess: () => { toast.success("Тест запущен"); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const pause = useMutation({
    mutationFn: () => pauseTest({ data: id }),
    onSuccess: () => void invalidate(),
  });
  const stop = useMutation({
    mutationFn: (restore: boolean) => stopTest({ data: { id, restore } }),
    onSuccess: () => { toast.success("Остановлен"); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const sw = useMutation({
    mutationFn: (variantId?: string) => switchVariantNow({ data: { testId: id, variantId } }),
    onSuccess: () => { toast.success("Вариант отправлен в Ozon"); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const metricsMut = useMutation({
    mutationFn: () => collectMetrics({ data: id }),
    onSuccess: (res) => {
      toast.success(res.collectMessage || "Метрики обновлены");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const winner = useMutation({
    mutationFn: (variantId: string) => applyWinner({ data: { testId: id, variantId } }),
    onSuccess: () => { toast.success("Победитель закреплён"); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [hours, setHours] = useState<number | null>(null);
  const schedule = useMutation({
    mutationFn: (d: { intervalHours: number; rotation: RotationMode }) =>
      updateTestSchedule({ data: { testId: id, ...d } }),
    onSuccess: () => { toast.success("Расписание сохранено"); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const photos = useMutation({
    mutationFn: (d: { variantId: string; images: string[] }) =>
      updateVariantImages({ data: { testId: id, variantId: d.variantId, images: d.images } }),
    onSuccess: () => {
      toast.success("Картинки сохранены");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteTest({ data: { id } }),
    onSuccess: () => { toast.success("Удалено"); void nav({ to: "/" }); },
  });
  if (q.isLoading) return <p className="text-muted">Загрузка…</p>;
  if (q.error) return <p className="text-danger">{(q.error as Error).message}</p>;
  const data = q.data!;
  const { test, variants, stats, significance, analyticsNote, metrics, ads } = data;
  const interval = hours ?? test.intervalHours;
  const exportCsv = () => {
    const header = "day,variant,views,carts,orders,revenue,ads_views,ads_clicks,ads_ctr,incomplete\n";
    const body = metrics
      .map((m) => {
        const ctr = m.adsViews > 0 ? (m.adsClicks / m.adsViews).toFixed(4) : "";
        return `${m.day},${m.variantLabel},${m.hitsView},${m.hitsTocart},${m.orderedUnits},${m.revenue},${m.adsViews},${m.adsClicks},${ctr},${m.incomplete}`;
      })
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ab-${test.id}.csv`;
    a.click();
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">{test.name}</h1>
          <p className="mt-1 text-xs text-subtle">
            Смена каждые {test.intervalHours} ч · вкладку можно закрыть
            {sched.data?.lastRunAt ? ` · тик ${formatDate(sched.data.lastRunAt)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {test.status === "draft" || test.status === "paused" ? (
            <Button onClick={() => run.mutate()} disabled={run.isPending}>Запустить</Button>
          ) : null}
          {test.status === "running" ? (
            <>
              <Button variant="secondary" onClick={() => pause.mutate()}>Пауза</Button>
              <Button variant="secondary" onClick={() => sw.mutate(undefined)} disabled={sw.isPending}>Сменить вариант</Button>
            </>
          ) : null}
          {test.status === "running" || test.status === "paused" ? (
            <Button variant="outline" onClick={() => stop.mutate(true)}>Стоп и откат</Button>
          ) : null}
          <Button variant="secondary" onClick={() => metricsMut.mutate()} disabled={metricsMut.isPending}>
            {metricsMut.isPending ? "Собираем…" : "Собрать метрики"}
          </Button>
          <Button variant="ghost" onClick={exportCsv}>CSV</Button>
        </div>
      </div>

      {analyticsNote ? <Card className="p-4 text-sm text-muted">{analyticsNote}</Card> : null}

      <Card>
        <p className="text-xs uppercase tracking-wide text-subtle">Реклама · Performance API</p>
        {ads.status === "ok" ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-subtle">Показы</dt><dd className="font-mono">{ads.views}</dd></div>
            <div><dt className="text-subtle">Клики</dt><dd className="font-mono">{ads.clicks}</dd></div>
            <div><dt className="text-subtle">CTR показ → клик</dt><dd className="font-mono">{formatCtr(ads.clicks, ads.views)}</dd></div>
            <div><dt className="text-subtle">В корзину</dt><dd className="font-mono">{ads.carts}</dd></div>
            <div><dt className="text-subtle">Заказы</dt><dd className="font-mono">{ads.orders}</dd></div>
            <div><dt className="text-subtle">Расход, ₽</dt><dd className="font-mono">{Math.round(ads.spend)}</dd></div>
            <div><dt className="text-subtle">Выручка, ₽</dt><dd className="font-mono">{Math.round(ads.revenue)}</dd></div>
          </dl>
        ) : null}
        <p className="mt-3 text-sm text-muted">{ads.note}</p>
      </Card>

      <Card className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-subtle">Расписание</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Часы на вариант</Label>
            <Input type="number" min={1} className="mt-1 w-28" value={interval} onChange={(e) => setHours(Number(e.target.value) || 1)} />
          </div>
          <Button variant="secondary" disabled={schedule.isPending} onClick={() => schedule.mutate({ intervalHours: interval, rotation: test.rotation })}>
            Сохранить
          </Button>
          <p className="text-sm text-muted">
            Сейчас {test.currentVariantLabel ?? "—"} · до смены {formatRemaining(test.nextSwitchAt)}
          </p>
        </div>
      </Card>

      {significance ? (
        <Card>
          <p className="text-xs uppercase tracking-wide text-subtle">Значимость</p>
          <p className="mt-2 text-sm">{significance.note}</p>
          {significance.ready && significance.winnerLabel ? (
            <Button className="mt-3" onClick={() => {
              const w = variants.find((v) => v.label === significance.winnerLabel);
              if (w) winner.mutate(w.id);
            }}>Закрепить победителя</Button>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {stats.map((s) => (
          <Card key={s.variant.id}>
            <div className="flex items-center justify-between">
              <p className="font-medium">Вариант {s.variant.label}</p>
              {s.variant.isControl ? <Badge>контроль</Badge> : null}
            </div>
            {s.variant.images[0] ? (
              <img src={s.variant.images[0]} alt="" className="mt-3 h-36 w-full rounded-[var(--radius-md)] object-cover" />
            ) : null}
            <p className="mt-3 truncate text-sm text-muted">{s.variant.title}</p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-subtle">Орг. просмотры</dt><dd className="font-mono">{s.hitsView}</dd></div>
              <div><dt className="text-subtle">В корзину</dt><dd className="font-mono">{s.hitsTocart}</dd></div>
              <div><dt className="text-subtle">Штуки</dt><dd className="font-mono">{s.orderedUnits}</dd></div>
              <div><dt className="text-subtle">Выручка</dt><dd className="font-mono">{Math.round(s.revenue)}</dd></div>
              {stats.some((x) => x.adsViews || x.adsClicks || x.adsSpend) ? (
                <>
                  <div><dt className="text-subtle">Рекл. показы</dt><dd className="font-mono">{s.adsViews}</dd></div>
                  <div><dt className="text-subtle">Рекл. клики</dt><dd className="font-mono">{s.adsClicks}</dd></div>
                  <div><dt className="text-subtle">CTR рекламы</dt><dd className="font-mono">{formatCtr(s.adsClicks, s.adsViews)}</dd></div>
                </>
              ) : null}
            </dl>
            {s.incompleteUnits > 0 ? (
              <p className="mt-2 text-xs text-warn">Сегодня ещё +{s.incompleteUnits} шт. (неполный день)</p>
            ) : null}
            {test.status === "running" ? (
              <Button variant="outline" className="mt-3" onClick={() => sw.mutate(s.variant.id)}>Поставить на карточку</Button>
            ) : null}
            {test.status !== "completed" ? (
              <VariantPhotos
                key={s.variant.id + s.variant.images.join("|")}
                urls={s.variant.images}
                disabled={photos.isPending}
                onSave={(images) => photos.mutate({ variantId: s.variant.id, images })}
              />
            ) : null}
          </Card>
        ))}
      </div>

      <Card>
        <p className="text-xs uppercase tracking-wide text-subtle">По дням</p>
        <div className="mt-3 overflow-x-auto text-sm">
          <table className="w-full text-left">
            <thead className="text-subtle">
              <tr>
                <th className="py-1 font-medium">День</th>
                <th>Вар.</th>
                <th>Просм.</th>
                <th>Корз.</th>
                <th>Шт.</th>
                <th>Рекл.</th>
                <th>CTR</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="py-1 font-mono">{m.day}</td>
                  <td>{m.variantLabel}</td>
                  <td>{m.hitsView}</td>
                  <td>{m.hitsTocart}</td>
                  <td>{m.orderedUnits}</td>
                  <td>{m.adsViews || m.adsClicks ? `${m.adsViews}/${m.adsClicks}` : "—"}</td>
                  <td>{formatCtr(m.adsClicks, m.adsViews)}</td>
                  <td>{m.incomplete ? "сегодня" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {metrics.length === 0 ? <p className="mt-2 text-muted">Метрик нет. Нажмите «Собрать метрики».</p> : null}
        </div>
      </Card>

      <Button variant="ghost" onClick={() => remove.mutate()}>Удалить тест</Button>
    </div>
  );
}

function VariantPhotos({
  urls,
  onSave,
  disabled,
}: {
  urls: string[];
  onSave: (images: string[]) => void;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(urls);
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-3">
      <ImageGallery urls={local} onChange={setLocal} label="Картинки варианта" />
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => onSave(local)}>
        Сохранить фото
      </Button>
    </div>
  );
}
