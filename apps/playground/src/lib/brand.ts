/**
 * The embed's theme API: the query parameters a partner sets on the `<iframe>` src so the widget
 * looks like their product instead of like ours. CSS cannot reach into an iframe, so the URL is the
 * only channel a one-line embed has.
 *
 * Two rules shape the whole module.
 *
 * **Every value is validated to a closed shape.** A colour is `#rrggbb` and nothing else; a font,
 * radius or density is a key of a constant map. These land in CSS custom properties, so an
 * unvalidated one is a stylesheet injection — `--accent: red } body { background: url(…)` — and the
 * declarations this module emits are the only untrusted-adjacent text in the document.
 *
 * **The widget derives the rest.** A partner sets four colours at most and the ~30 semantic roles
 * behind them are computed, so a brand colour cannot produce a CTA nobody can read: the button
 * label is chosen by the fill's own luminance, and a colour used as text is nudged toward the
 * surface's ink until it clears 4.5:1. That is what keeps layer 2's brand rules enforceable while
 * the palette underneath belongs to someone else.
 */

/** `auto` follows the visitor's OS; the other two pin it, which is what a partner's page wants. */
const THEME_CHOICES = { light: null, dark: null, auto: null } as const;
export type ThemeChoice = keyof typeof THEME_CHOICES;

/** Only cards, panels and insets — every pill and disc in the sheet is a hardcoded 9999px. */
export const RADIUS_SCALES = {
  square: { large: '0px', regular: '0px', inset: '0px', small: '0px' },
  sharp: { large: '8px', regular: '6px', inset: '4px', small: '3px' },
  soft: { large: '24px', regular: '16px', inset: '12px', small: '8px' },
  round: { large: '32px', regular: '24px', inset: '18px', small: '12px' },
} as const;
export type RadiusChoice = keyof typeof RADIUS_SCALES;

/**
 * Loaded already or resolvable from the visitor's system — no webfont is fetched on a URL
 * parameter's say-so, even an allowlisted one. A partner's own licensed face needs an entry here.
 */
export const FONT_STACKS = {
  inter: '"Inter", system-ui, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: '"Inria Serif", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;
export type FontChoice = keyof typeof FONT_STACKS;

/** Spacing and the two display sizes, so a tight sidebar gets a shorter iframe. */
export const DENSITIES = {
  comfortable: {},
  compact: {
    '--space-8': '6px',
    '--space-16': '12px',
    '--space-24': '18px',
    '--text-hero': '32px',
    '--text-amount': '30px',
    '--text-symbol': '20px',
  },
} as const;
export type DensityChoice = keyof typeof DENSITIES;

export type Brand = {
  theme: ThemeChoice | undefined;
  /** Emphasis and, unless `cta` overrides it, the primary button. */
  accent: string | undefined;
  cta: string | undefined;
  /** The widget's ground. Text is derived from it when `text` is unset. */
  surface: string | undefined;
  text: string | undefined;
  radius: RadiusChoice | undefined;
  font: FontChoice | undefined;
  density: DensityChoice | undefined;
};

export const NO_BRAND: Brand = {
  theme: undefined,
  accent: undefined,
  cta: undefined,
  surface: undefined,
  text: undefined,
  radius: undefined,
  font: undefined,
  density: undefined,
};

export function isBranded(brand: Brand): boolean {
  return Object.values(brand).some(value => value !== undefined);
}

/* ── Reading the URL ─────────────────────────────────────────────────────── */

const HEX = /^#?(?:[\da-f]{3}|[\da-f]{6})$/i;

/**
 * Normalized to `#rrggbb`, the only colour shape that ever reaches a custom property. The `#` is
 * optional because a partner writing the iframe by hand would otherwise have to escape it as `%23`.
 */
export function readColor(value: string | null): string | undefined {
  if (!value || !HEX.test(value)) return undefined;
  const digits = value.replace('#', '').toLowerCase();
  return `#${digits.length === 3 ? [...digits].map(digit => digit + digit).join('') : digits}`;
}

// `Object.hasOwn`, not `in`: `in` walks the prototype, so `?font=toString` would pass and then be
// indexed for a stack that does not exist.
function readChoice<T extends string>(choices: Record<T, unknown>, value: string | null): T | undefined {
  return value && Object.hasOwn(choices, value) ? (value as T) : undefined;
}

export function readBrand(search: string): Brand {
  const params = new URLSearchParams(search);

  return {
    theme: readChoice(THEME_CHOICES, params.get('theme')),
    accent: readColor(params.get('accent')),
    cta: readColor(params.get('cta')),
    surface: readColor(params.get('surface')),
    text: readColor(params.get('text')),
    radius: readChoice(RADIUS_SCALES, params.get('radius')),
    font: readChoice(FONT_STACKS, params.get('font')),
    density: readChoice(DENSITIES, params.get('density')),
  };
}

/**
 * One field, through the same gate a URL goes through. The playground's controls use this rather
 * than casting their own values, so nothing the UI can set is anything a link could not.
 */
export function readBrandField<K extends keyof Brand>(key: K, value: string | null): Brand[K] {
  const params = new URLSearchParams();
  if (value !== null) params.set(key, value);
  return readBrand(params.toString())[key];
}

/** Colours are written without the `#`, so a copied `<iframe>` carries no `%23` noise. */
export function writeBrand(params: URLSearchParams, brand: Brand): void {
  if (brand.theme) params.set('theme', brand.theme);
  if (brand.accent) params.set('accent', brand.accent.slice(1));
  if (brand.cta) params.set('cta', brand.cta.slice(1));
  if (brand.surface) params.set('surface', brand.surface.slice(1));
  if (brand.text) params.set('text', brand.text.slice(1));
  if (brand.radius) params.set('radius', brand.radius);
  if (brand.font) params.set('font', brand.font);
  if (brand.density) params.set('density', brand.density);
}

/* ── Colour maths ────────────────────────────────────────────────────────── */

type Rgb = [number, number, number];

/** The two brand inks a derived foreground picks between: charcoal and white, 1:1 with layer 1. */
const INK_DARK = '#1d1414';
const INK_LIGHT = '#ffffff';

/** Layer 2's `--surface-card` per theme, so a brand with no surface still derives against the real one. */
export const DEFAULT_SURFACE: Record<'light' | 'dark', string> = { light: '#ffffff', dark: '#241a19' };

/**
 * Where the playground's colour inputs start when a field is unset — layer 2's own light values,
 * mirrored because `<input type="color">` has no empty state. Nothing renders from these.
 */
export const BRAND_DEFAULTS = {
  accent: '#a55c55',
  cta: '#a55c55',
  surface: '#ffffff',
  text: '#483434',
} as const;
export type ColorField = keyof typeof BRAND_DEFAULTS;

const AA_TEXT = 4.5;

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(rgb: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

function linear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function mix(from: string, to: string, weight: number): string {
  const [r1, g1, b1] = toRgb(from);
  const [r2, g2, b2] = toRgb(to);
  const blend = (a: number, b: number) => a + (b - a) * weight;
  return toHex([blend(r1, r2), blend(g1, g2), blend(b1, b2)]);
}

/** Whichever brand ink is readable on `background`. This is what stops white-on-yellow. */
function ink(background: string): string {
  return contrast(INK_DARK, background) >= contrast(INK_LIGHT, background) ? INK_DARK : INK_LIGHT;
}

/** Toward the colour's own ink: darkens a light colour, lightens a dark one. */
function step(hex: string, weight: number): string {
  return mix(hex, ink(hex), weight);
}

/** Away from it, which is the other half of a hover/active pair whichever way round it is. */
function lift(hex: string, weight: number): string {
  return mix(hex, ink(hex) === INK_DARK ? INK_LIGHT : INK_DARK, weight);
}

/** Nudges a colour toward the surface's ink until it clears `target`, so brand text stays readable. */
function readable(color: string, surface: string, target: number): { value: string; corrected: boolean } {
  if (contrast(color, surface) >= target) return { value: color, corrected: false };

  const toward = ink(surface);
  for (let weight = 0.1; weight < 1; weight += 0.1) {
    const candidate = mix(color, toward, weight);
    if (contrast(candidate, surface) >= target) return { value: candidate, corrected: true };
  }
  return { value: toward, corrected: true };
}

/* ── Deriving the roles ──────────────────────────────────────────────────── */

type Declarations = Record<string, string>;

/** Reported back to the playground so a partner sees the correction rather than wondering. */
export type BrandNote = string;

function colorRoles(brand: Brand, theme: 'light' | 'dark'): { decls: Declarations; notes: BrandNote[] } {
  const decls: Declarations = {};
  const notes: BrandNote[] = [];
  const surface = brand.surface ?? DEFAULT_SURFACE[theme];
  const onSurface = ink(surface);

  if (brand.surface) {
    Object.assign(decls, {
      '--surface-card': surface,
      '--surface-page': surface,
      '--surface-embed': surface,
      '--form-surface': surface,
      '--surface-inset': step(surface, 0.04),
      '--surface-note': step(surface, 0.04),
      '--panel-halo': step(surface, 0.09),
      '--panel-halo-hover': step(surface, 0.15),
      '--border-subtle': step(surface, 0.12),
      '--border-inset': step(surface, 0.08),
      '--border-strong': step(surface, 0.22),
      '--flip-bg': step(surface, 0.08),
      '--flip-bg-hover': step(surface, 0.15),
      '--flip-fg': mix(surface, onSurface, 0.8),
      '--chip-shadow': step(surface, 0.28),
      '--logo-shadow': step(surface, 0.2),
    });
  }

  // A partner-set surface re-derives the whole text ramp even with no `text`, or their ground would
  // carry our ink — a dark surface with charcoal body copy.
  const heading = brand.text ?? (brand.surface ? onSurface : undefined);

  if (heading) {
    const checked = readable(heading, surface, AA_TEXT);
    if (checked.corrected) notes.push('Text colour was moved toward readable — it failed 4.5:1 on that surface.');

    Object.assign(decls, {
      '--text-heading': checked.value,
      '--text-body': mix(checked.value, surface, 0.12),
      '--text-muted': mix(checked.value, surface, 0.34),
      '--text-faint': mix(checked.value, surface, 0.52),
    });
  }

  if (brand.accent) {
    const checked = readable(brand.accent, surface, AA_TEXT);
    if (checked.corrected) notes.push('Accent was darkened or lightened where it is used as text — it failed 4.5:1.');

    decls['--accent'] = checked.value;
    decls['--accent-hover'] = step(checked.value, 0.14);
    // The flow title is decorative-large, so it keeps the brand colour exactly as given.
    decls['--lockup-accent'] = brand.accent;
  }

  const cta = brand.cta ?? brand.accent;

  if (cta) {
    Object.assign(decls, {
      '--cta-bg': cta,
      '--cta-bg-hover': step(cta, 0.12),
      '--cta-bg-active': lift(cta, 0.14),
      '--cta-fg': ink(cta),
      '--cta-ring': lift(cta, 0.2),
    });
  }

  return { decls, notes };
}

/** Theme-invariant: a radius, a font stack and a spacing scale mean the same thing in either theme. */
function shapeRoles(brand: Brand): Declarations {
  const decls: Declarations = {};

  if (brand.radius) {
    const scale = RADIUS_SCALES[brand.radius];
    decls['--radius-large'] = scale.large;
    decls['--radius-regular'] = scale.regular;
    decls['--radius-inset'] = scale.inset;
    decls['--radius-small'] = scale.small;
  }

  if (brand.font) {
    decls['--font-body'] = FONT_STACKS[brand.font];
    decls['--font-display'] = FONT_STACKS[brand.font];
  }

  Object.assign(decls, brand.density ? DENSITIES[brand.density] : {});

  return decls;
}

function block(selector: string, decls: Declarations): string {
  const body = Object.entries(decls)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return body ? `${selector} {\n${body}\n}` : '';
}

export type BrandStyles = { css: string; notes: BrandNote[] };

/**
 * The stylesheet a brand resolves to, as one block per theme.
 *
 * The dark block is not optional even when the two derive to the same values: `index.css` maps its
 * dark roles under `:root[data-theme="dark"]`, which outranks a bare `:root`, so a light-only
 * override would be won back on every token the dark theme sets.
 */
export function brandStyles(brand: Brand): BrandStyles {
  const light = colorRoles(brand, 'light');
  const dark = colorRoles(brand, 'dark');

  const css = [block(':root', { ...shapeRoles(brand), ...light.decls }), block(':root[data-theme="dark"]', dark.decls)]
    .filter(Boolean)
    .join('\n\n');

  return { css, notes: [...new Set([...light.notes, ...dark.notes])] };
}
