import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type Option = { value: string; label: string; sublabel?: string };

/** A searchable single-select (combobox): a trigger button + a popover with a filter input. */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = 'Select',
  searchPlaceholder = 'Search…',
  disabled,
  leading,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  leading?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find(o => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter(o => `${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(q)) : options;

  return (
    <Popover.Root
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm',
          'transition-colors hover:border-cherry-soda/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {leading}
        <span className={cn('flex-1 truncate text-left', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={e => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(
            'z-50 w-(--radix-popover-trigger-width) overflow-hidden rounded-xl border border-border bg-popover shadow-xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 opacity-40" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-64 overflow-auto p-1">
            {filtered.map(o => (
              <button
                type="button"
                key={o.value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                  'hover:bg-accent',
                  o.value === value && 'bg-accent',
                )}
              >
                <span className="flex-1 truncate font-medium">{o.label}</span>
                {o.sublabel && <span className="truncate text-xs text-muted-foreground">{o.sublabel}</span>}
                {o.value === value && <Check className="size-4 shrink-0 text-cherry-soda" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">No matches</div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
