import { useTranslation } from 'react-i18next';
import { Tag, Tooltip } from '@/components/ui/misc';
import { zdrState } from '@/lib/models/models';
import type { ZdrEndpoint } from '@/lib/types';

/** ZDR status pill: strict ZDR (green), ZDR with safety retention (amber), none (gray). */
export function ZdrTag({ zdr }: { zdr: ZdrEndpoint[] }) {
  const { t } = useTranslation();
  const st = zdrState(zdr);
  const strict = zdr.filter((e) => !e.safetyRetention).map((e) => e.tag);
  const all = zdr.map((e) => e.tag);
  const hint =
    st === 'strict'
      ? t('zdr.strictHint', { endpoints: strict.join(', ') })
      : st === 'sr'
        ? t('zdr.srHint', { endpoints: all.join(', ') })
        : t('zdr.noneHint');
  return (
    <Tooltip content={hint}>
      <Tag tone={st === 'strict' ? 'ok' : st === 'sr' ? 'warn' : undefined}>
        {st === 'strict' ? t('zdr.strict') : st === 'sr' ? t('zdr.sr') : t('zdr.none')}
      </Tag>
    </Tooltip>
  );
}
