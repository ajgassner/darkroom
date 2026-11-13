import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea, Tooltip } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { importImages } from '@/lib/actions';
import { composerSummary } from '@/lib/labels';
import { mentionKeyAction, mentionQuery } from '@/lib/mentions';
import { allowedByPrivacy } from '@/lib/models';
import { generate } from '@/lib/runs';
import { useData, useSettings, useUi } from '@/lib/store';
import type { ElementInfo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ElementThumb } from './shared';

export function Composer() {
  const { t } = useTranslation();
  const mode = useSettings((s) => s.mode);
  const audioKind = useSettings((s) => s.audioKind);
  const prompt = useUi((s) => s.prompt);
  const presets = useData((s) => s.presets);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [clickLock, setClickLock] = useState(false);
  const mention = useMentions(ref);

  const placeholder =
    mode === 'image'
      ? t('composer.placeholderImage')
      : audioKind === 'music'
        ? t('composer.placeholderMusic')
        : t('composer.placeholderSpeech');

  const go = () => {
    if (clickLock) return;
    // Several runs may run at the same time; the short lock only prevents double clicks
    setClickLock(true);
    setTimeout(() => setClickLock(false), 1000);
    generate();
  };

  return (
    <div className="sticky top-16 z-[3] rounded-[14px] border border-line bg-panel p-3">
      <Textarea
        ref={ref}
        rows={3}
        value={prompt}
        placeholder={placeholder}
        onChange={(e) => {
          useUi.setState({ prompt: e.target.value });
          mention.update();
        }}
        onClick={mention.update}
        onBlur={() => setTimeout(mention.close, 150)}
        onKeyDown={(e) => {
          if (mention.onKeyDown(e)) return;
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go();
        }}
        className="border-none bg-transparent p-1 text-[15px] focus-visible:border-none"
      />
      <MentionBox state={mention} />
      <div className="mt-2 flex items-center gap-2.5">
        {mode === 'image' && (
          <>
            <Select
              className="w-[180px]"
              value=""
              onValueChange={(v) => {
                const p = presets[Number(v)];
                if (p) useUi.setState({ prompt: p.prompt });
                ref.current?.focus();
              }}
              options={[
                { value: '', label: t('composer.preset') },
                ...presets.map((p, i) => ({ value: String(i), label: p.name })),
              ]}
            />
            <Tooltip content={t('composer.importHint')}>
              <label className="cursor-pointer rounded-lg border border-line bg-panel-2 px-[11px] py-[7px] text-[13px] whitespace-nowrap hover:border-accent">
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  hidden
                  onChange={(e) => {
                    void importImages([...(e.target.files ?? [])]);
                    e.target.value = '';
                  }}
                />
                {t('composer.importImage')}
              </label>
            </Tooltip>
          </>
        )}
        <Summary />
        <GenerateButton locked={clickLock} onClick={go} />
      </div>
    </div>
  );
}

function Summary() {
  const { t } = useTranslation();
  const settings = useSettings();
  const models = useData((d) => d.models);
  const costs = useData((d) => d.status?.costs);
  const promptLength = useUi((u) => u.prompt.length);
  const running = useUi((u) => u.liveRuns.length);
  const text = composerSummary(t, { settings, models, costs, promptLength, running });
  return <span className="flex-1 text-xs text-muted">{text}</span>;
}

function GenerateButton({ locked, onClick }: { locked: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const s = useSettings();
  const { models, speechModels, status } = useData();
  let ok: boolean;
  if (s.mode === 'image') ok = models.some((m) => s.models.includes(m.id) && allowedByPrivacy(m.zdr, s.privacy));
  else if (s.audioKind === 'music') ok = Boolean(s.musicModel);
  else {
    const m = speechModels.find((x) => x.id === s.speechModel);
    ok = Boolean(m && allowedByPrivacy(m.zdr, s.privacy));
  }
  return (
    <Button variant="primary" disabled={!ok || !status?.hasKey || locked} onClick={onClick}>
      {t('composer.generate')}
    </Button>
  );
}

// ---------------------------------------------------------------- @-mention suggestions

interface MentionState {
  open: boolean;
  items: ElementInfo[];
  index: number;
  empty: boolean;
  update: () => void;
  close: () => void;
  insert: (e: ElementInfo) => void;
  onKeyDown: (e: React.KeyboardEvent) => boolean;
}

function useMentions(ref: React.RefObject<HTMLTextAreaElement | null>): MentionState {
  const elements = useData((s) => s.elements);
  const mode = useSettings((s) => s.mode);
  const [st, setSt] = useState({ open: false, items: [] as ElementInfo[], index: 0, start: 0, end: 0 });

  const update = () => {
    const ta = ref.current;
    if (!ta || mode !== 'image' || ta.selectionStart !== ta.selectionEnd) return setSt((s) => ({ ...s, open: false }));
    const q = mentionQuery(ta.value, ta.selectionStart);
    if (!q) return setSt((s) => ({ ...s, open: false }));
    const needle = q.query.toLowerCase();
    const items = elements
      .filter((e) => !needle || e.name.toLowerCase().includes(needle) || e.label.toLowerCase().includes(needle))
      .sort(
        (a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)),
      )
      .slice(0, 8);
    setSt((s) => ({
      open: true,
      items,
      index: Math.min(s.index, Math.max(0, items.length - 1)),
      start: q.start,
      end: q.end,
    }));
  };

  const insert = (e: ElementInfo) => {
    const ta = ref.current;
    if (!ta) return;
    const v = ta.value;
    const after = v.slice(st.end);
    const text = `@${e.name}${after.startsWith(' ') ? '' : ' '}`;
    useUi.setState({ prompt: v.slice(0, st.start) + text + after });
    const pos = st.start + text.length;
    requestAnimationFrame(() => {
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
    setSt((s) => ({ ...s, open: false }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!st.open || !st.items.length) return false;
    const action = mentionKeyAction(e);
    if (!action) return false;
    e.preventDefault();
    if (action === 'pick') insert(st.items[st.index]);
    else if (action === 'close') setSt((s) => ({ ...s, open: false }));
    else {
      const step = action === 'next' ? 1 : -1;
      setSt((s) => ({ ...s, index: (s.index + step + s.items.length) % s.items.length }));
    }
    return true;
  };

  // Close suggestions when switching to audio mode
  useEffect(() => {
    if (mode !== 'image') setSt((s) => ({ ...s, open: false }));
  }, [mode]);

  return {
    open: st.open,
    items: st.items,
    index: st.index,
    empty: !elements.length,
    update,
    close: () => setSt((s) => ({ ...s, open: false })),
    insert,
    onKeyDown,
  };
}

function MentionBox({ state }: { state: MentionState }) {
  const { t } = useTranslation();
  if (!state.open) return null;
  return (
    <div className="absolute top-[92px] right-3 left-3 z-20 max-w-[460px] rounded-[10px] border border-line bg-panel p-1 shadow-2xl">
      {state.items.length === 0 ? (
        <div className="p-2 text-xs text-muted">{state.empty ? t('elements.empty') : '—'}</div>
      ) : (
        state.items.map((e, i) => (
          <button
            key={e.name}
            type="button"
            onMouseDown={(ev) => {
              ev.preventDefault();
              state.insert(e);
            }}
            className={cn(
              'grid w-full cursor-pointer grid-cols-[32px_auto_1fr] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-panel-2',
              i === state.index && 'bg-panel-2',
            )}
          >
            {e.photos[0] ? (
              <ElementThumb el={e} file={e.photos[0]} size={32} />
            ) : (
              <span className="size-8 rounded-md bg-panel-2" />
            )}
            <span>@{e.name}</span>
            <span className="text-right text-xs text-muted">
              {t(`types.${e.type}`)} · {e.photos.length}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
