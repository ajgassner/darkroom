// API types come from the shared contract in @darkroom/core (type-only, nothing is bundled).
import type { RunEvent as CoreRunEvent, FatalEvent, ImageModelInfo, StatusResponse } from '@darkroom/core/contract';

export type {
  CostSummary,
  DebugRecord,
  ElementInfo,
  ElementType,
  ImagePrice,
  ManifestEntry,
  MusicModel,
  Notice,
  ParamSpec,
  Preset,
  PrivacyMode,
  SpeechModel,
  UpdateResponse,
  VoiceInfo,
  ZdrEndpoint,
} from '@darkroom/core/contract';

/** Image model as returned by GET /api/models. */
export type ImageModel = ImageModelInfo;
export type Status = StatusResponse;
export type RunEvent = CoreRunEvent | FatalEvent;
