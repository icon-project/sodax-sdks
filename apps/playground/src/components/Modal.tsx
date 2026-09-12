import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  title,
  open,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="widget-modal"
      aria-label={title}
      onClose={onClose}
      onCancel={event => {
        if (busy) event.preventDefault();
      }}
    >
      <header className="row-between">
        <h2>{title}</h2>
        <button className="btn" type="button" onClick={onClose} disabled={busy} aria-label={`Close ${title}`}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
