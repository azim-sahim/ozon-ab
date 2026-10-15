import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app")({ component: AppShell });

function AppShell() {
  const { user, isPending } = useCurrentUserState();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-bg px-6 text-center">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-subtle">Seller tools</p>
          <h1 className="mt-2 text-2xl font-medium text-fg">Ozon A/B</h1>
          <p className="mt-2 text-sm text-muted">Проверяем сессию…</p>
        </div>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-bg px-6 text-center">
        <div className="space-y-3">
          <h1 className="text-2xl font-medium text-fg">Ozon A/B</h1>
          <p className="text-sm text-muted">Войдите, чтобы подключить кабинет Ozon.</p>
          <a href="/login" className="inline-block rounded-[var(--radius-sm)] bg-primary px-4 py-2 text-sm font-medium text-primary-fg">
            Перейти ко входу
          </a>
        </div>
      </main>
    );
  }
  const nav = [
    { to: "/", label: "Тесты" },
    { to: "/profit", label: "Дашборд" },
    { to: "/shops", label: "Магазины" },
    { to: "/logs", label: "Журнал" },
  ];
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[88rem] items-center gap-6 px-4 py-3">
          <Link to="/" className="text-sm font-medium tracking-tight">
            Ozon A/B
          </Link>
          <nav className="flex gap-4 text-sm">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn("text-muted hover:text-fg", (n.to === "/" ? path === "/" : path.startsWith(n.to)) && "text-fg")}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <UserButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[88rem] px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
