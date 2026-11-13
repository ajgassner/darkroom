import { ImageOffIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { addReference, deleteEntries, entryError, reuseSettings } from '@/lib/actions';
import { canBeTransparent, downloadUrl, outUrl, refThumbUrl } from '@/lib/api';
import { entryTitle } from '@/lib/models/tools';
import { type LiveRun, useData, useSettings, useUi } from '@/lib/store';
import { num, usd } from '@/lib/text/format';
import { deleteTexts, runMetaParts, voiceLabel } from '@/lib/text/labels';
import type { ManifestEntry } from '@/lib/types';
import { focusComposer, runCardId } from '@/lib/ui/scroll';
import { refLabel, runRefThumbs } from '@/lib/ui/uploads';
import { cn } from '@/lib/utils';
import { useModelName } from '../hooks/useModelName';
import { AudioPlayer } from '../shared';

export function Gallery() {
  const { t } = useTranslation();
  const history = useData((s) => s.history);
  const live = useUi((s) => s.liveRuns);
  const mode = useSettings((s) => s.mode);
  const runs = useMemo(() => {
    // Group entries by run, newest first; skip runs that are still shown as live cards
    const liveIds = new Set(live.map((r) => r.runId).filter(Boolean));
    const map = new Map<string, ManifestEntry[]>();
    for (const e of history) {
      if (liveIds.has(e.runId)) continue;
      const list = map.get(e.runId);
      if (list) list.push(e);
      else map.set(e.runId, [e]);
    }
    return [...map.values()];
  }, [history, live]);

  return (
    <div id="gallery" className="mt-3.5 flex flex-col gap-[26px]">
      {live.map((r) => (
        <LiveCard key={r.key} run={r} />
      ))}
      {runs.map((entries) => (
        <RunCard key={entries[0].runId} entries={entries} />
      ))}
      {!runs.length && !live.length && (
        <p className="text-muted">{mode === 'audio' ? t('gallery.emptyAudio') : t('gallery.empty')}</p>
      )}
    </div>
  );
}

function useVoiceLabel() {
  const { t } = useTranslation();
  const voices = useData((s) => s.voices);
  return (v?: string) => voiceLabel(t, voices, v);
}

function RunMeta({ first, entries }: { first: Partial<ManifestEntry>; entries: ManifestEntry[] }) {
  const { t, i18n } = useTranslation();
  const name = useModelName();
  const voice = useVoiceLabel();
  const when = first.ts ? new Date(first.ts).toLocaleString(i18n.resolvedLanguage) : null;
  const meta = [...runMetaParts(t, first, voice), when];
  const models = [...new Set(entries.map((e) => e.model))].map(name);
  return (
    <div className="mt-0.5 text-xs text-muted">
      {[...meta.filter(Boolean), ...(models.length ? [models.join(', ')] : [])].join(' · ')}
    </div>
  );
}

function CardHead({
  first,
  entries,
  actions,
  refs,
}: {
  first: Partial<ManifestEntry>;
  entries: ManifestEntry[];
  actions: React.ReactNode;
  /** Thumbnails of the run's additional references, under the meta line */
  refs?: React.ReactNode;
}) {
  const { t } = useTranslation();
  // Failed calls can be charged too (their entries then carry the cost)
  const cost = entries.reduce((s, e) => s + (e.cost ?? 0), 0);
  return (
    // Below md the actions go under the title, so title and meta keep the full width
    <div className="mb-2.5 flex flex-col gap-2 md:flex-row md:justify-between md:gap-4">
      <div className="min-w-0">
        <div className="line-clamp-2 text-[13px] break-words">{entryTitle(t, first)}</div>
        <RunMeta first={first} entries={entries} />
        {refs}
      </div>
      <div className="flex shrink-0 items-center gap-2 md:items-start">
        <span className="text-muted tabular-nums">{usd(cost)}</span>
        {actions}
      </div>
    </div>
  );
}

function RunCard({ entries }: { entries: ManifestEntry[] }) {
  const { t } = useTranslation();
  const first = entries[0];
  const okCount = entries.filter((e) => e.ok).length;
  return (
    // Shown from elsewhere (e.g. "Previous uploads"): focused and highlighted briefly (lib/ui/scroll.ts)
    <div
      id={runCardId(first.runId)}
      tabIndex={-1}
      className="-m-2 rounded-xl p-2 outline-none transition-shadow duration-500 data-highlight:ring-2 data-highlight:ring-accent"
    >
      <CardHead
        first={first}
        entries={entries}
        refs={first.tool ? null : <RefThumbs refs={first.extraRefs} />}
        actions={
          <>
            {!first.tool && (
              <Button size="sm" onClick={() => reuseSettings(entries)}>
                {t('gallery.reuse')}
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              onClick={() => void deleteEntries({ runId: first.runId }, t('gallery.confirmRun', { count: okCount }))}
            >
              {t('gallery.delete')}
            </Button>
          </>
        }
      />
      <Grid>
        {entries.map((e) => (
          <Tile key={e.id ?? e.file ?? e.ts} e={e} />
        ))}
      </Grid>
    </div>
  );
}

/** The run's additional references as small thumbnails; a click adds one to the current references again. */
function RefThumbs({ refs }: { refs: string[] | undefined }) {
  const { t } = useTranslation();
  const { shown, more } = runRefThumbs(refs);
  if (!shown.length) return null;
  return (
    <ul aria-label={t('gallery.refs')} className="m-0 mt-1.5 flex list-none flex-wrap items-center gap-1.5 p-0">
      {shown.map((file, i) => (
        <li key={file}>
          <RefThumb file={file} label={refLabel(t, file, i + 1)} />
        </li>
      ))}
      {more > 0 && (
        <li className="text-xs text-muted" aria-label={t('gallery.refsMore', { count: more })}>
          +{more}
        </li>
      )}
    </ul>
  );
}

function RefThumb({ file, label }: { file: string; label: string }) {
  const { t } = useTranslation();
  // A result used as reference may have been deleted since
  const [gone, setGone] = useState(false);
  const text = gone ? t('gallery.refGone', { ref: label }) : t('gallery.refUse', { ref: label });
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      disabled={gone}
      onClick={() => addReference(file, t('toast.refsAdded', { count: 1 }))}
      className="grid size-9 cursor-pointer place-items-center overflow-hidden rounded-md border border-line bg-panel-2 p-0 text-muted outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:hover:border-line"
    >
      {gone ? (
        <ImageOffIcon className="size-3.5" />
      ) : (
        <img
          src={refThumbUrl(file)}
          alt={label}
          loading="lazy"
          decoding="async"
          onError={() => setGone(true)}
          className="size-full object-cover"
        />
      )}
    </button>
  );
}

function LiveCard({ run }: { run: LiveRun }) {
  const { t } = useTranslation();
  const name = useModelName();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // Placeholders: per model, the planned count minus results already received
  const pending: { model: string; i: number }[] = [];
  for (const { model, count } of run.plan) {
    const got = run.entries.filter((e) => e.model === model).length;
    for (let i = got; i < count; i++) pending.push({ model, i });
  }
  const seconds = Math.round((now - run.startedAt) / 1000);
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = card.current;
    // The card disappears when the run ends (e.g. after cancelling with the keyboard): move the focus to the
    // composer instead of losing it to the page. Layout cleanups run while the card is still in the DOM.
    return () => {
      if (el?.contains(document.activeElement)) requestAnimationFrame(focusComposer);
    };
  }, []);
  return (
    <div ref={card}>
      <CardHead
        first={run.first}
        entries={run.entries}
        actions={
          // aria-disabled instead of disabled: a disabled button would drop the keyboard focus right away
          <Button
            size="sm"
            variant="danger"
            aria-disabled={run.cancelling}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (!run.cancelling) run.cancel();
            }}
          >
            {run.cancelling ? t('gallery.cancelling') : t('gallery.cancel')}
          </Button>
        }
      />
      <Grid>
        {run.entries.map((e) => (
          <Tile key={e.id ?? e.ts} e={e} />
        ))}
        {pending.map((p) => (
          <div
            key={`${p.model}-${p.i}`}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-[10px] border border-line bg-panel-2 p-3.5 text-center text-xs"
          >
            <Spinner />
            <div>{name(p.model)}</div>
            <div className="text-muted">{num(seconds)} s</div>
          </div>
        ))}
      </Grid>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">{children}</div>;
}

function DeleteButton({ e, className }: { e: ManifestEntry; className?: string }) {
  const { t } = useTranslation();
  const { label, confirm } = deleteTexts(t, e);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(ev) => {
        ev.stopPropagation();
        void deleteEntries({ ids: e.id ? [e.id] : [], files: e.file ? [e.file] : [] }, ev.shiftKey ? null : confirm);
      }}
      className={cn(
        'absolute top-1.5 right-1.5 z-[2] grid size-[30px] cursor-pointer place-items-center rounded-lg bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-err focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
        className,
      )}
    >
      <Trash2Icon className="size-4" />
    </button>
  );
}

function Tile({ e }: { e: ManifestEntry }) {
  const { t } = useTranslation();
  const name = useModelName();
  if (!e.ok) {
    return (
      <div
        title={e.error}
        className="group relative flex min-h-40 flex-col items-center justify-center gap-2 rounded-[10px] border border-line bg-panel-2 p-3.5 text-center text-xs text-err"
      >
        <DeleteButton e={e} className="opacity-100" />
        <div className="text-muted">{name(e.model)}</div>
        <div>{entryError(e).slice(0, 220)}</div>
        {e.debugId && (
          <Button size="sm" className="mt-1 text-[11px]" onClick={() => useUi.setState({ debugEntry: e })}>
            {t('gallery.debug')}
          </Button>
        )}
      </div>
    );
  }
  if (e.kind === 'audio') return <AudioTile e={e} />;
  return (
    <button
      type="button"
      onClick={() => useUi.setState({ lightbox: e })}
      className="group relative min-h-40 cursor-zoom-in overflow-hidden rounded-[10px] border border-line bg-panel-2 text-left"
    >
      <DeleteButton e={e} />
      {e.file && <TileImage file={e.file} alt={entryTitle(t, e)} />}
      <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1.5 bg-gradient-to-b from-transparent to-black/75 px-2 pt-[18px] pb-1.5 text-[11px] text-white">
        <span>{name(e.model)}</span>
        <span>
          {usd(e.cost)} · {num(e.durationMs / 1000)} s
        </span>
      </div>
    </button>
  );
}

/** Result image; PNG/WebP get the checkerboard behind transparent parts once loaded (no flash while loading). */
function TileImage({ file, alt }: { file: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={outUrl(file)}
      loading="lazy"
      alt={alt}
      onLoad={() => setLoaded(true)}
      className={cn('block size-full object-cover', loaded && canBeTransparent(file) && 'checker')}
    />
  );
}

function AudioTile({ e }: { e: ManifestEntry }) {
  const { t } = useTranslation();
  const name = useModelName();
  const voiceLabel = useVoiceLabel();
  const stripMeta = useSettings((s) => s.stripMeta);
  const music = (e.params as { mode?: string }).mode === 'music';
  if (!e.file) return null;
  return (
    <div className="group relative flex flex-col gap-2 rounded-[10px] border border-line bg-panel-2 p-3">
      <DeleteButton e={e} className="bg-transparent text-muted opacity-100 hover:text-white" />
      <div className="text-[11px] tracking-[0.05em] text-accent-2 uppercase">
        {music ? `♫ ${t('gallery.music')}` : `🗣 ${t('gallery.speech')}`}
      </div>
      <div className="line-clamp-4 pr-8 text-[13px]">{e.prompt}</div>
      <AudioPlayer src={outUrl(e.file)} className="mt-0.5" />
      <div className="flex justify-between gap-1.5 text-[11px] text-muted">
        <span>
          {name(e.model)}
          {music ? '' : ` · ${voiceLabel(e.voice)}`}
        </span>
        <span>
          {usd(e.cost)} · {num(e.durationMs / 1000)} s
        </span>
      </div>
      <div className="flex justify-between text-xs">
        <a
          className="text-accent-2 no-underline hover:underline"
          href={downloadUrl(e.file, stripMeta)}
          download={e.file}
        >
          {stripMeta ? t('gallery.downloadClean') : t('common.download')}
        </a>
        {e.debugId && (
          <button
            type="button"
            className="cursor-pointer text-accent-2 hover:underline"
            onClick={() => useUi.setState({ debugEntry: e })}
          >
            Debug
          </button>
        )}
      </div>
    </div>
  );
}
