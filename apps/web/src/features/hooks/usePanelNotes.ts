import { useData, useSettings, useUi } from '@/lib/store';
import { audioNotes, imageNotes, type Note } from '@/lib/text/notes';
import { useModelName } from './useModelName';

/** Notes of the open side panel (image or audio) for the current settings. */
export function usePanelNotes(): Note[] {
  const settings = useSettings();
  const { models, elements, speechModels, musicModels, voices, status } = useData();
  const prompt = useUi((u) => u.prompt);
  const extraRefCount = useUi((u) => u.extraRefs.length);
  const modelName = useModelName();
  if (settings.mode === 'audio') return audioNotes({ status, settings, speechModels, musicModels, voices });
  return imageNotes({ status, settings, models, elements, prompt, extraRefCount, modelName });
}
