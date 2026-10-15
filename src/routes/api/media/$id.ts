import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/media/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { readMedia } = await import("@/lib/server/media");
        const file = await readMedia(params.id);
        if (!file) return new Response("Not found", { status: 404 });
        return new Response(new Uint8Array(file.bytes), {
          headers: {
            "Content-Type": file.mime,
            "Content-Disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    },
  },
});
