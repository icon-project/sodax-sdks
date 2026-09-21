import { shorten } from '../lib/format';
import { accountUrl, txUrl } from '../lib/explorer';

export type HashLinkProps = {
  value: string;
  kind: 'tx' | 'account';
  full?: boolean;
};

export default function HashLink({ value, kind, full = false }: HashLinkProps) {
  return (
    <a
      className="font-mono text-xs text-primary underline break-all"
      href={kind === 'tx' ? txUrl(value) : accountUrl(value)}
      target="_blank"
      rel="noreferrer"
    >
      {full ? value : shorten(value, 8)}
    </a>
  );
}
