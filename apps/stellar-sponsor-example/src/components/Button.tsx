import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'warning';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-muted',
  ghost: 'border border-border bg-transparent hover:bg-secondary',
  warning: 'bg-warning text-warning-foreground hover:opacity-90',
};

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
};

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

export default function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button type="button" className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...props} />;
}
