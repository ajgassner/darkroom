// Privacy modes: which provider endpoints a model may be called on.
import type { PrivacyMode, ZdrEndpoint } from './contract.ts';

/** Provider tags a model is restricted to in the given privacy mode (null = no restriction). */
export function allowedProviders(modelId: string, mode: PrivacyMode, zdr: Map<string, ZdrEndpoint[]>): string[] | null {
  if (mode === 'off') return null;
  const eps = zdr.get(modelId) ?? [];
  return eps.filter((e) => mode === 'zdr' || !e.safetyRetention).map((e) => e.tag);
}

/** Whether a model with these ZDR endpoints may be used in the given mode. */
export function privacyAllows(zdr: ZdrEndpoint[], mode: PrivacyMode): boolean {
  if (mode === 'off') return true;
  return mode === 'zdr' ? zdr.length > 0 : zdr.some((e) => !e.safetyRetention);
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
