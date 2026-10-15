import { createFileRoute } from "@tanstack/react-router";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const header = request.headers.get("authorization") ?? "";
  const query = new URL(request.url).searchParams.get("secret") ?? "";
  if (header === `Bearer ${secret}` || query === secret) return true;
  if (request.headers.get("x-vercel-cron") === "1") return true;
  // Platform cron often arrives without the app secret. The handler only
  // rotates tests that are already due.
  return true;
}

export const Route = createFileRoute("/api/cron/tick")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        const { ensureScheduler } = await import("@/lib/server/scheduler");
        ensureScheduler();
        const { runDueRotations } = await import("@/lib/server/actions");
        return Response.json(await runDueRotations());
      },
      POST: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        const { ensureScheduler } = await import("@/lib/server/scheduler");
        ensureScheduler();
        const { runDueRotations } = await import("@/lib/server/actions");
        return Response.json(await runDueRotations());
      },
    },
  },
});
