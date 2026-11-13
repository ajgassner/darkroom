// API types come from the shared contract in @darkroom/core (type-only, nothing is bundled).
import type {
  RunEvent as CoreRunEvent,
  FatalEvent,
  ImageModelInfo,
  MusicModelInfo,
  SpeechModelInfo,
  StatusResponse,
} from '@darkroom/core/contract';

export type {
  CostSummary,
  DebugRecord,
  ElementInfo,
  ElementType,
  Favorites,
  ImagePrice,
  ManifestEntry,
  ModelKind,
  ModelMarks,
  Notice,
  ParamSpec,
  Preset,
  PrivacyMode,
  UpdateResponse,
  UploadInfo,
  VoiceInfo,
  ZdrEndpoint,
} from '@darkroom/core/contract';

/** Image model as returned by GET /api/models. */
export type ImageModel = ImageModelInfo;
/** Speech model as returned by GET /api/speech/models. */
export type SpeechModel = SpeechModelInfo;
/** Music model as returned by GET /api/music/models. */
export type MusicModel = MusicModelInfo;
export type Status = StatusResponse;
export type RunEvent = CoreRunEvent | FatalEvent;
