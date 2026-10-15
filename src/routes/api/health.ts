import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { ensureScheduler } = await import("@/lib/server/scheduler");
        ensureScheduler();
        let db = "unknown";
        try {
          const { getSql, dbSource } = await import("@/lib/db");
          const sql = await getSql();
          await sql`select 1 as ok`;
          db = dbSource;
        } catch {
          db = "error";
        }
        return Response.json({ ok: db !== "error", db });
      },
    },
  },
});
