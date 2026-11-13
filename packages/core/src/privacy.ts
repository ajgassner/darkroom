// Privacy modes: which provider endpoints a model may be called on.
import type { PrivacyMode, ZdrEndpoint } from './contract.ts';
import { zdrEndpoints } from './openrouter.ts';

/** Provider tags a model is restricted to in the given privacy mode (null = no restriction). */
export function allowedProviders(modelId: string, mode: PrivacyMode, zdr: Map<string, ZdrEndpoint[]>): string[] | null {
  if (mode === 'off') return null;
  const eps = zdr.get(modelId) ?? [];
  return eps.filter((e) => mode === 'zdr' || !e.safetyRetention).map((e) => e.tag);
}

/** Provider tags for one model, looked up in the current ZDR endpoint list (null = no restriction, [] = blocked). */
export async function modelRestriction(modelId: string, mode: PrivacyMode): Promise<string[] | null> {
  return mode === 'off' ? null : allowedProviders(modelId, mode, await zdrEndpoints());
}

/** Request field that restricts a call to these providers, without falling back to others. */
export function providerField(restriction: string[] | null): {
  provider?: { only: string[]; allow_fallbacks: false };
} {
  return restriction ? { provider: { only: restriction, allow_fallbacks: false } } : {};
}

/** Manifest error fields for a model the privacy mode does not allow. */
export function privacyBlocked(mode: PrivacyMode): { error: string; errorCode: string } {
  return mode === 'zdr-strict'
    ? {
        error:
          'No ZDR endpoint without safety retention for this model. Relax the privacy mode or choose another model.',
        errorCode: 'privacy_blocked_strict',
      }
    : {
        error: 'No Zero Data Retention endpoint for this model. Set privacy to "off" or choose another model.',
        errorCode: 'privacy_blocked',
      };
}
