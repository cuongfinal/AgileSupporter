/**
 * Opening slides of the demo deck (cover, agenda, sprint data, goal …): edit their text and drop in fresh screenshots.
 * The slots come from the active template (`sprint_deck.py intro`); edits live in the demo draft, keyed by shape id,
 * and are applied at build time — text keeps the template's formatting, images are fitted inside the old frame.
 */
import { useQuery } from "@tanstack/react-query";
import { type ClipboardEvent, type DragEvent, useRef, useState } from "react";
import { ChevronRightIcon, RefreshIcon, UploadIcon } from "@/components/icons";
import { Button, Spinner, Tag, Textarea } from "@/components/kit";
import { Card, Empty, Loader } from "@/components/ui";
import { http } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { DemoDraft, DemoIntroEdits, DemoIntroSlide, DemoIntroSlideEdit, DemoIntroTemplate } from "@/lib/types";

const IMAGE_TYPES = ["image/png", "image/jpeg"];

const imageUrl = (name: string, tpl?: string) =>
  `/api/demo/intro/file?name=${encodeURIComponent(name)}${tpl ? `&tpl=${encodeURIComponent(tpl)}` : ""}`;

async function uploadImage(file: Blob): Promise<string> {
  const res = await fetch("/api/demo/intro", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
  const j = (await res.json().catch(() => ({}))) as { name?: string; error?: string };
  if (!res.ok || !j.name) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.name;
}

const editCount = (e: DemoIntroSlideEdit | undefined) => (e ? Object.keys(e.texts).length + Object.keys(e.images).length : 0);

function ImageSlot({
  slot,
  templateId,
  uploaded,
  onPick,
  onReset,
}: {
  slot: DemoIntroSlide["images"][number];
  templateId: string;
  uploaded: string | undefined;
  onPick: (name: string) => void;
  onReset: () => void;
}) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const take = (file: File | undefined | null) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error(t("demo.intro.badType"));
      return;
    }
    setBusy(true);
    uploadImage(file)
      .then(onPick)
      .catch((e) => toast.fromError(t("demo.intro.uploadFailed"), e))
      .finally(() => setBusy(false));
  };
  const onPaste = (e: ClipboardEvent) => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
    if (file) {
      e.preventDefault();
      take(file);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files[0]);
  };

  return (
    <figure className="m-0 min-w-0">
      <div
        tabIndex={0}
        role="group"
        aria-label={`${t("demo.intro.images")} · ${t("demo.intro.drop")}`}
        title={t("demo.intro.drop")}
        onPaste={onPaste}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`relative grid place-items-center overflow-hidden rounded-md border-2 border-dashed bg-ui-surface transition-colors ${
          over ? "border-ui-brand bg-ui-brand-surface" : uploaded ? "border-ui-brand-soft" : "border-ui-border hover:border-ui-outline"
        }`}
        // The frame keeps the slide slot's own proportions, so what you see is how much of it the image will fill.
        style={{ aspectRatio: `${slot.width} / ${slot.height}` }}
      >
        {/* Local API-served previews; next/image optimisation adds nothing here (same as DemoRecorder). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={uploaded ? imageUrl(uploaded) : imageUrl(slot.preview, templateId)}
          alt=""
          className={`block max-h-full max-w-full object-contain ${uploaded ? "" : "opacity-60"}`}
        />
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-ui-overlay">
            <Spinner />
          </span>
        )}
      </div>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Tag size="sm" color={uploaded ? "primary" : "neutral"}>
          {uploaded ? t("demo.intro.newImage") : t("demo.intro.fromTemplate")}
        </Tag>
        <Button size="sm" variant="ghost" leftIcon={<UploadIcon />} disabled={busy} onClick={() => input.current?.click()}>
          {uploaded ? t("demo.intro.replace") : t("demo.intro.choose")}
        </Button>
        {uploaded && (
          <Button size="sm" variant="ghost" color="neutral" title={t("demo.intro.reset")} aria-label={t("demo.intro.reset")} onClick={onReset}>
            <RefreshIcon />
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </figcaption>
    </figure>
  );
}

function SlideEditor({
  slide,
  templateId,
  edit,
  onChange,
}: {
  slide: DemoIntroSlide;
  templateId: string;
  edit: DemoIntroSlideEdit | undefined;
  onChange: (fn: (e: DemoIntroSlideEdit) => DemoIntroSlideEdit) => void;
}) {
  const { t } = useT();
  const edited = editCount(edit);
  const setText = (id: number, original: string, value: string) =>
    onChange((e) => {
      const texts = { ...e.texts };
      if (value === original) delete texts[id];
      else texts[id] = value;
      return { ...e, texts };
    });
  const setImage = (id: number, name: string | null) =>
    onChange((e) => {
      const images = { ...e.images };
      if (name) images[id] = name;
      else delete images[id];
      return { ...e, images };
    });

  return (
    <details className="group rounded-md border border-ui-border bg-ui-raised" open={slide.images.length > 0}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="shrink-0 text-ui-muted transition-transform group-open:rotate-90" />
        <span className="font-semibold text-ui-heading">{t("demo.intro.slide", { n: slide.n })}</span>
        <span className="min-w-0 flex-1 truncate text-ui-body">{slide.title}</span>
        <span className="text-xs text-ui-secondary">{t("demo.intro.counts", { texts: slide.texts.length, images: slide.images.length })}</span>
        {edited > 0 && (
          <Tag size="sm" color="primary">
            {t("demo.intro.edited", { n: edited })}
          </Tag>
        )}
      </summary>
      <div className="grid grid-cols-1 gap-4 border-t border-ui-border p-3 lg:grid-cols-2">
        {slide.texts.length > 0 && (
          <fieldset className="m-0 min-w-0 space-y-2.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-2xs font-semibold uppercase tracking-wider text-ui-secondary">{t("demo.intro.texts")}</legend>
            {slide.texts.map((x) => {
              const value = edit?.texts[x.id] ?? x.text;
              const changed = edit?.texts[x.id] !== undefined;
              return (
                <div key={x.id} className="flex items-start gap-1.5">
                  <Textarea
                    size="sm"
                    fullWidth
                    minRows={Math.min(4, value.split("\n").length)}
                    aria-label={x.text.split("\n")[0]}
                    value={value}
                    onChange={(e) => setText(x.id, x.text, e.target.value)}
                    className={changed ? "!border-ui-brand" : undefined}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    color="neutral"
                    title={t("demo.intro.reset")}
                    aria-label={`${t("demo.intro.reset")}: ${x.text.split("\n")[0]}`}
                    disabled={!changed}
                    onClick={() => setText(x.id, x.text, x.text)}
                  >
                    <RefreshIcon />
                  </Button>
                </div>
              );
            })}
          </fieldset>
        )}
        {slide.images.length > 0 && (
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-2xs font-semibold uppercase tracking-wider text-ui-secondary">{t("demo.intro.images")}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {slide.images.map((img) => (
                <ImageSlot
                  key={img.id}
                  slot={img}
                  templateId={templateId}
                  uploaded={edit?.images[img.id]}
                  onPick={(name) => setImage(img.id, name)}
                  onReset={() => setImage(img.id, null)}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-ui-secondary">
              {t("demo.intro.drop")}. {t("demo.intro.fit")}.
            </p>
          </fieldset>
        )}
      </div>
    </details>
  );
}

export default function IntroSlides({
  draft,
  update,
  templateId,
}: {
  draft: DemoDraft | null;
  update: (fn: (d: DemoDraft) => DemoDraft) => void;
  templateId: string | undefined;
}) {
  const { t } = useT();
  const q = useQuery({
    queryKey: ["demo-intro", templateId],
    queryFn: () => http.get<DemoIntroTemplate>("/api/demo/intro"),
    enabled: !!templateId,
    staleTime: Infinity,
  });
  const edits = templateId && draft?.intro?.templateId === templateId ? draft.intro : undefined;
  const foreign = !!draft?.intro && draft.intro.templateId !== templateId && Object.keys(draft.intro.slides).length > 0;
  const slides = (q.data?.slides ?? []).filter((s) => s.texts.length || s.images.length);
  const total = Object.values(edits?.slides ?? {}).reduce((n, e) => n + editCount(e), 0);

  const patch = (n: number, fn: (e: DemoIntroSlideEdit) => DemoIntroSlideEdit) =>
    update((d) => {
      if (!templateId) return d;
      const base: DemoIntroEdits = d.intro?.templateId === templateId ? d.intro : { templateId, slides: {} };
      const next = fn(base.slides[n] ?? { texts: {}, images: {} });
      const all = { ...base.slides };
      if (editCount(next)) all[n] = next;
      else delete all[n];
      return { ...d, intro: { templateId, slides: all } };
    });

  return (
    <Card
      className="mb-4"
      title={t("demo.intro.title")}
      actions={
        total > 0 && (
          <Tag size="sm" color="primary">
            {t("demo.intro.edited", { n: total })}
          </Tag>
        )
      }
    >
      <p className="mb-3 text-xs text-ui-secondary">{t("demo.intro.hint")}</p>
      {foreign && (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-ui-warning bg-ui-warning-surface px-3 py-2 text-sm text-ui-warning-dark">
          <span>{t("demo.intro.otherTemplate")}</span>
          <Button size="sm" variant="outline" color="neutral" onClick={() => update((d) => ({ ...d, intro: undefined }))}>
            {t("demo.intro.clear")}
          </Button>
        </div>
      )}
      {!templateId && <Empty>{t("demo.intro.noTemplate")}</Empty>}
      {templateId && q.isLoading && <Loader />}
      {q.error && <p className="text-sm text-ui-error">{(q.error as Error).message}</p>}
      {q.data?.error && <p className="whitespace-pre-wrap text-sm text-ui-error">{q.data.error}</p>}
      {q.data && !q.data.error && !slides.length && <Empty>{t("demo.intro.none")}</Empty>}
      {templateId && draft && slides.length > 0 && (
        <div className="space-y-2">
          {slides.map((s) => (
            <SlideEditor key={s.n} slide={s} templateId={templateId} edit={edits?.slides[s.n]} onChange={(fn) => patch(s.n, fn)} />
          ))}
        </div>
      )}
    </Card>
  );
}
