import React, { useRef, useState } from 'react';

/**
 * Shared wiring for a search `<Input>` placed inside a Radix Select dropdown.
 * Radix steals focus to the selected/active item on open and on every filter re-render, and its
 * typeahead hijacks keystrokes — so we restore focus via a ref and stop key propagation.
 *
 * Usage:
 *   const { search, inputProps, handleOpenChange } = useRadixSearchInput();
 *   <Select onOpenChange={handleOpenChange}>… <Input {...inputProps} /> …</Select>
 */
export function useRadixSearchInput() {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus());

  const inputProps = {
    ref: inputRef,
    value: search,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      focusInput();
    },
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      focusInput();
    } else {
      setSearch('');
    }
  };

  return { search, inputProps, handleOpenChange };
}
