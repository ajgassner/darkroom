import { Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { deleteEntries, entryError, reuseSettings } from '@/lib/actions';
import { downloadUrl, outUrl } from '@/lib/api';
import { runMetaParts, voiceLabel } from '@/lib/labels';
import { usd } from '@/lib/pricing';
import { type LiveRun, useData, useSettings, useUi } from '@/lib/store';
import type { ManifestEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AudioPlayer } from './shared';
import { useModelName } from './useModelName';

export function Gallery() {
  const { t } = useTranslation();
  const history = useData((s) => s.history);
  const live = useUi((s) => s.liveRuns);
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
    <div className="mt-[22px] flex flex-col gap-[26px]">
      {live.map((r) => (
        <LiveCard key={r.key} run={r} />
      ))}
      {runs.map((entries) => (
        <RunCard key={entries[0].runId} entries={entries} />
      ))}
      {!runs.length && !live.length && <p className="text-muted">{t('gallery.empty')}</p>}
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
}: {
  first: Partial<ManifestEntry>;
  entries: ManifestEntry[];
  actions: React.ReactNode;
}) {
  // Failed calls can be charged too (their entries then carry the cost)
  const cost = entries.reduce((s, e) => s + (e.cost ?? 0), 0);
  return (
    <div className="mb-2.5 flex justify-between gap-4">
      <div className="min-w-0">
        <div className="line-clamp-2 text-[13px]">{first.prompt}</div>
        <RunMeta first={first} entries={entries} />
      </div>
      <div className="flex shrink-0 items-start gap-2">
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
    <div>
      <CardHead
        first={first}
        entries={entries}
        actions={
          <>
            {!first.tool && (
              <Button size="sm" onClick={() => reuseSettings(first)}>
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
  return (
    <div>
      <CardHead
        first={run.first}
        entries={run.entries}
        actions={
          <Button size="sm" variant="danger" disabled={run.cancelling} onClick={run.cancel}>
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
            <div className="text-muted">{seconds} s</div>
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
  return (
    <button
      type="button"
      title={e.ok ? t('gallery.deleteImage') : t('gallery.removeError')}
      aria-label={e.ok ? t('gallery.deleteImage') : t('gallery.removeError')}
      onClick={(ev) => {
        ev.stopPropagation();
        const skip = !e.ok || ev.shiftKey;
        void deleteEntries(
          { ids: e.id ? [e.id] : [], files: e.file ? [e.file] : [] },
          skip ? null : t('gallery.confirmImage'),
        );
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
      {e.file && <img src={outUrl(e.file)} loading="lazy" alt={e.prompt} className="block size-full object-cover" />}
      <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1.5 bg-gradient-to-b from-transparent to-black/75 px-2 pt-[18px] pb-1.5 text-[11px] text-white">
        <span>{name(e.model)}</span>
        <span>
          {usd(e.cost)} · {(e.durationMs / 1000).toFixed(0)} s
        </span>
      </div>
    </button>
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
          {usd(e.cost)} · {(e.durationMs / 1000).toFixed(0)} s
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
