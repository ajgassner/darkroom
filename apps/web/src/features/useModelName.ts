import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { modelName } from '@/lib/labels';
import { useData } from '@/lib/store';

/** Display name for any model id (image, speech, music, local tools). */
export function useModelName() {
  const { t } = useTranslation();
  const models = useData((s) => s.models);
  const speech = useData((s) => s.speechModels);
  const music = useData((s) => s.musicModels);
  return useCallback((id: string) => modelName(t, id, [models, speech, music]), [t, models, speech, music]);
}
