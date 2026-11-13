import { PauseIcon, PlayIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTitle, Tooltip } from '@/components/ui/misc';
import { elementPhotoUrl } from '@/lib/api';
import type { Note, NoteKey } from '@/lib/notes';
import { fmtTime } from '@/lib/pricing';
import type { ElementInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Compact audio player with play/pause, seek slider and time; only one plays at a time. */
export function AudioPlayer({ src, className }: { src: string; className?: string }) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const onPlay = () => {
      setPlaying(true);
      for (const other of document.querySelectorAll<HTMLAudioElement>('audio[data-player]'))
        if (other !== a) other.pause();
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      a.currentTime = 0;
    };
    const onTime = () => setPos(a.currentTime);
    const onMeta = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onError = () => setFailed(true);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('durationchange', onMeta);
      a.removeEventListener('error', onError);
    };
  }, []);

  const shown = drag ?? pos;
  const pct = dur ? (shown / dur) * 100 : 0;
  return (
    <div
      className={cn(
        'grid w-full min-w-0 grid-cols-[auto_1fr_auto] items-center gap-2 rounded-full border border-line bg-panel py-1 pr-2.5 pl-1',
        className,
      )}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: generated speech/music without captions */}
      <audio ref={audio} src={src} preload="metadata" data-player className="hidden" />
      <button
        type="button"
        title={playing ? t('player.pause') : t('player.play')}
        aria-label={playing ? t('player.pause') : t('player.play')}
        disabled={failed}
        onClick={(e) => {
          e.stopPropagation();
          const a = audio.current;
          if (!a) return;
          if (!a.paused) return a.pause();
          // A pause() right after play() rejects with AbortError; only real failures mark the file unavailable
          a.play().catch((err: unknown) => {
            if ((err as Error | null)?.name !== 'AbortError') setFailed(true);
          });
        }}
        className="grid size-[30px] cursor-pointer place-items-center rounded-full bg-accent text-white hover:bg-accent-2 disabled:cursor-default disabled:opacity-45 disabled:hover:bg-accent"
      >
        {playing ? <PauseIcon className="size-3 fill-current" /> : <PlayIcon className="size-3 fill-current" />}
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(pct * 10)}
        aria-label={t('player.position')}
        className="seek"
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDrag((Number(e.target.value) / 1000) * dur)}
        onPointerUp={(e) => {
          const a = audio.current;
          if (a && dur) a.currentTime = (Number((e.target as HTMLInputElement).value) / 1000) * dur;
          setDrag(null);
        }}
        onKeyUp={(e) => {
          const a = audio.current;
          if (a && dur) a.currentTime = (Number((e.target as HTMLInputElement).value) / 1000) * dur;
          setDrag(null);
        }}
      />
      <span className="text-[11px] whitespace-nowrap text-muted tabular-nums">
        {failed ? t('player.unavailable') : `${fmtTime(shown)} / ${fmtTime(dur)}`}
      </span>
    </div>
  );
}

/** Selectable chip (aspect ratio, size, …); "partial" shows a ≈ marker. */
export function Chip({
  active,
  partial,
  disabled,
  title,
  onClick,
  className,
  children,
}: {
  active?: boolean;
  partial?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  const button = (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'relative cursor-pointer rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[13px] hover:border-accent disabled:cursor-not-allowed disabled:opacity-50',
        active && 'border-accent bg-[color-mix(in_srgb,var(--accent)_18%,var(--panel-2))]',
        className,
      )}
    >
      {children}
      {partial && <span className="absolute -top-[7px] -right-1 text-[11px] text-warn">≈</span>}
    </button>
  );
  return title ? <Tooltip content={title}>{button}</Tooltip> : button;
}

export function ElementThumb({
  el,
  file,
  size = 52,
  className,
}: {
  el: ElementInfo;
  file: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={elementPhotoUrl(el.name, file, size > 100 ? 240 : 120)}
      alt=""
      title={`@${el.name}`}
      style={{ width: size, height: size }}
      className={cn('checker block rounded-md border border-line object-cover', className)}
    />
  );
}

/** Dashed drop zone with hidden file input; also accepts drag and drop. */
export function DropZone({
  label,
  accept,
  onFiles,
  className,
}: {
  label: ReactNode;
  accept: string;
  onFiles: (files: File[]) => void;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
      className={cn(
        'block cursor-pointer rounded-[10px] border-[1.5px] border-dashed border-line p-3.5 text-center text-[13px] text-muted',
        over && 'border-accent text-text',
        className,
      )}
    >
      <input
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {label}
    </label>
  );
}

/** "Notes" section of a side panel; renders nothing without notes. */
export function NotesSection({ notes }: { notes: Note[] }) {
  const { t } = useTranslation();
  if (!notes.length) return null;
  // The key is typed, but i18next can't match params to a union of keys, so translate via a plain signature
  const translate = t as unknown as (key: `notes.${NoteKey}`, params?: Note['params']) => string;
  const items = notes.map((n) => ({ tone: n.tone, text: translate(`notes.${n.key}`, n.params) }));
  return (
    <section>
      <SectionTitle>{t('notes.title')}</SectionTitle>
      <ul className="m-0 list-disc pl-[18px] text-xs text-muted">
        {items.map((n) => (
          <li key={n.text} className={cn(n.tone === 'warn' && 'text-warn', n.tone === 'err' && 'text-err')}>
            {n.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
