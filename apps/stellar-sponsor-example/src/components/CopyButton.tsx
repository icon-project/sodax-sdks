import { useState } from 'react';
import Button from './Button';

/** Clipboard may be unavailable on plain-HTTP LAN origins. */
export default function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'unavailable'>('idle');

  const onCopy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('unavailable');
    }
    setTimeout(() => setState('idle'), 1_500);
  };

  return (
    <Button variant="ghost" size="sm" onClick={onCopy} aria-live="polite">
      {state === 'copied' ? 'Copied' : state === 'unavailable' ? 'Select and copy' : label}
    </Button>
  );
}
