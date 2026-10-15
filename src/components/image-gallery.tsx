import { useRef, useState } from "react";
import { uploadMedia } from "@/lib/server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

async function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(blob);
  });
}

async function compressFile(file: File): Promise<{ mime: string; dataBase64: string; filename: string }> {
  if (!file.type.startsWith("image/")) throw new Error("Это не картинка");
  const dataUrl = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Повреждённый файл"));
    el.src = dataUrl;
  });
  const max = 2000;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен");
  ctx.drawImage(img, 0, 0, w, h);
  const keepPng = file.type === "image/png" || file.type === "image/gif";
  const mime = keepPng ? "image/png" : "image/jpeg";
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Сжатие не удалось"))), mime, 0.88);
  });
  if (blob.size > 4.5 * 1024 * 1024) throw new Error("После сжатия файл всё ещё слишком большой");
  const b64 = await readAsDataUrl(blob);
  return { mime, dataBase64: b64, filename: file.name.replace(/\.[^.]+$/, keepPng ? ".png" : ".jpg") };
}

export function ImageGallery({
  urls,
  onChange,
  label,
}: {
  urls: string[];
  onChange: (next: string[]) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  const addFiles = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      const origin = window.location.origin;
      const next = [...urls];
      for (const file of [...files]) {
        const packed = await compressFile(file);
        const saved = await uploadMedia({
          data: { filename: packed.filename, mime: packed.mime, dataBase64: packed.dataBase64, origin },
        });
        next.push(saved.url);
      }
      onChange(next);
      toast.success(files.length > 1 ? "Картинки загружены" : "Картинка загружена");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      {label ? <p className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</p> : null}
      <p className="text-xs text-muted">Первая — главное фото. Ozon заберёт файлы с этого сайта по HTTPS.</p>
      <div className="flex flex-wrap gap-2">
        {urls.map((url, i) => (
          <div key={`${url}-${i}`} className="relative">
            <img
              src={url}
              alt=""
              className={cn(
                "h-20 w-20 rounded-[var(--radius-sm)] object-cover border border-border",
                i === 0 && "ring-1 ring-primary",
              )}
            />
            {i === 0 ? (
              <span className="absolute bottom-1 left-1 rounded bg-bg/80 px-1 text-[10px] text-fg">главное</span>
            ) : null}
            <button
              type="button"
              className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-elevated text-xs text-muted"
              onClick={() => onChange(urls.filter((_, j) => j !== i))}
              aria-label="Убрать"
            >
              ×
            </button>
            {i > 0 ? (
              <button
                type="button"
                className="absolute -left-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-elevated text-[10px] text-muted"
                onClick={() => {
                  const next = [...urls];
                  const [item] = next.splice(i, 1);
                  next.unshift(item);
                  onChange(next);
                }}
                aria-label="Сделать главной"
              >
                ↑
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
          }}
        />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Загрузка…" : "С компьютера"}
        </Button>
        <Input
          className="max-w-xs"
          placeholder="или вставить URL https://…"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const u = urlDraft.trim();
              if (/^https?:\/\//i.test(u)) {
                onChange([...urls, u]);
                setUrlDraft("");
              } else toast.error("Нужна ссылка http(s)");
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const u = urlDraft.trim();
            if (/^https?:\/\//i.test(u)) {
              onChange([...urls, u]);
              setUrlDraft("");
            } else toast.error("Нужна ссылка http(s)");
          }}
        >
          Добавить URL
        </Button>
      </div>
    </div>
  );
}
