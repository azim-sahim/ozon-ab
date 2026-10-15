import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTests, getSchedulerStatus } from "@/lib/server/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatRemaining } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({ component: Dashboard });

function Dashboard() {
  const qc = useQueryClient();
  const tests = useQuery({ queryKey: ["tests"], queryFn: () => listTests() });
  const sched = useQuery({
    queryKey: ["sched"],
    queryFn: async () => {
      const s = await getSchedulerStatus();
      if (s.lastSwitched > 0) void qc.invalidateQueries({ queryKey: ["tests"] });
      return s;
    },
    refetchInterval: 15000,
  });
  const rows = tests.data ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Тесты карточек</h1>
          <p className="mt-1 text-sm text-muted">
            Ротация на сервере
            {sched.data?.lastRunAt ? ` · последний тик ${formatDate(sched.data.lastRunAt)}` : " · тик ещё не был"}
          </p>
        </div>
        <Link to="/tests/new">
          <Button>Новый тест</Button>
        </Link>
      </div>
      {rows.length === 0 ? (
        <Card className="space-y-3 p-8">
          <p className="text-lg">Пока пусто</p>
          <p className="text-sm text-muted">Подключите магазин и запустите A/B на карточке Ozon.</p>
          <div className="flex gap-2">
            <Link to="/shops">
              <Button variant="secondary">Магазины</Button>
            </Link>
            <Link to="/tests/new">
              <Button>Создать тест</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((t) => (
            <Link key={t.id} to="/tests/$id" params={{ id: t.id }} className="block">
              <Card className="flex flex-wrap items-center gap-4 p-4 hover:bg-elevated">
                {t.productImage ? (
                  <img src={t.productImage} alt="" className="h-14 w-14 rounded-[var(--radius-sm)] object-cover" />
                ) : (
                  <div className="h-14 w-14 rounded-[var(--radius-sm)] bg-elevated" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="truncate text-sm text-muted">{t.productName} · {t.shopName}</p>
                </div>
                <Badge>{t.status}</Badge>
                {t.status === "running" ? (
                  <span className="text-xs text-subtle">{t.currentVariantLabel} · {formatRemaining(t.nextSwitchAt)}</span>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
