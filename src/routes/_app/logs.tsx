import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listLogs } from "@/lib/server/actions";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export const Route = createFileRoute("/_app/logs")({ component: LogsPage });

function LogsPage() {
  const logs = useQuery({ queryKey: ["logs"], queryFn: () => listLogs() });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-medium tracking-tight">Журнал</h1>
      {(logs.data ?? []).map((l) => (
        <Card key={l.id} className="p-4">
          <p className="text-xs text-subtle">{formatDate(l.createdAt)} · {l.action}</p>
          <p className="mt-1 text-sm">{l.detail ?? "—"}</p>
        </Card>
      ))}
      {(logs.data ?? []).length === 0 ? <p className="text-sm text-muted">Пока нет событий.</p> : null}
    </div>
  );
}
