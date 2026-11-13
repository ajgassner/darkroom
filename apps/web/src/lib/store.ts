import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  ElementInfo,
  ImageModel,
  ManifestEntry,
  MusicModel,
  Preset,
  PrivacyMode,
  SpeechModel,
  Status,
  UpdateResponse,
  VoiceInfo,
} from './types';

// ---------------------------------------------------------------- Settings (persisted per browser)

export interface Settings {
  mode: 'image' | 'audio';
  privacy: PrivacyMode;
  // image
  element: string;
  usePrefix: boolean;
  models: string[];
  aspect: string;
  size: string;
  quality: string;
  format: string;
  count: number;
  stripMeta: boolean;
  // audio
  audioKind: 'speech' | 'music';
  speechModel: string;
  voice: string;
  instructions: string;
  speed: number;
  musicModel: string;
  transcribeEngine: '' | 'local' | 'api';
  transcribeLang: string;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'image',
  privacy: 'zdr',
  element: '',
  usePrefix: true,
  models: [],
  aspect: '3:4',
  size: '2K',
  quality: '',
  format: '',
  count: 1,
  stripMeta: false,
  audioKind: 'speech',
  speechModel: '',
  voice: '',
  instructions: '',
  speed: 1,
  musicModel: '',
  transcribeEngine: '',
  transcribeLang: 'auto',
};

const SETTINGS_KEY = 'darkroom.settings';
interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
    }),
    {
      name: SETTINGS_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ set: _set, ...rest }) => rest,
    },
  ),
);

// ---------------------------------------------------------------- Server data

interface DataState {
  status: Status | null;
  models: ImageModel[];
  elements: ElementInfo[];
  presets: Preset[];
  history: ManifestEntry[];
  speechModels: SpeechModel[];
  musicModels: MusicModel[];
  voices: VoiceInfo[];
  /** Newer release, if any (checked after loading) */
  update: UpdateResponse['update'];
}

export const useData = create<DataState>()(() => ({
  status: null,
  models: [],
  elements: [],
  presets: [],
  history: [],
  speechModels: [],
  musicModels: [],
  voices: [],
  update: null,
}));

// ---------------------------------------------------------------- UI state (not persisted)

type ExtraRef = { kind: 'out'; outFile: string } | { kind: 'upload'; dataUrl: string; name: string };

export interface LiveFirst {
  kind?: 'image' | 'audio';
  prompt: string;
  element?: string;
  tool?: string;
  toolOptions?: Record<string, string>;
  voice?: string;
  params: Record<string, unknown>;
}

export interface LiveRun {
  key: string;
  runId?: string;
  first: LiveFirst;
  plan: { model: string; count: number }[];
  entries: ManifestEntry[];
  startedAt: number;
  cancelling: boolean;
  cancel: () => void;
}

interface UiState {
  prompt: string;
  extraRefs: ExtraRef[];
  showAllModels: boolean;
  showAllSpeech: boolean;
  liveRuns: LiveRun[];
  lightbox: ManifestEntry | null;
  elementsOpen: boolean;
  editingElement: string | null;
  voicesOpen: boolean;
  editingVoice: string | null;
  debugEntry: ManifestEntry | null;
  pasteFiles: File[] | null;
  /** "voice/file" keys of samples currently being transcribed */
  transcribing: string[];
  /** Initial data load: the UI shows a loading screen until it is 'ready' */
  load: { state: 'loading' | 'ready' } | { state: 'failed'; error: string };
}

export const useUi = create<UiState>()(() => ({
  prompt: '',
  extraRefs: [],
  showAllModels: false,
  showAllSpeech: false,
  liveRuns: [],
  lightbox: null,
  elementsOpen: false,
  editingElement: null,
  voicesOpen: false,
  editingVoice: null,
  debugEntry: null,
  pasteFiles: null,
  transcribing: [],
  load: { state: 'loading' },
}));

export function updateLiveRun(key: string, patch: Partial<LiveRun> | ((r: LiveRun) => Partial<LiveRun>)) {
  useUi.setState((s) => ({
    liveRuns: s.liveRuns.map((r) =>
      r.key === key ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r,
    ),
  }));
}
