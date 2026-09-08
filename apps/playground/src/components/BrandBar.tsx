import type { BrandControls } from '../hooks/useBrand';
import {
  BRAND_DEFAULTS,
  type Brand,
  type ColorField,
  DENSITIES,
  FONT_STACKS,
  RADIUS_SCALES,
  readBrandField,
} from '../lib/brand';

/** Hints are `title` tooltips, not a line under each cell: eight of those cost ~90px of height. */
const COLOR_FIELDS: readonly { key: ColorField; label: string; hint: string }[] = [
  { key: 'accent', label: 'Accent', hint: 'Emphasis, and the button unless one is set below' },
  { key: 'cta', label: 'Button', hint: 'Its label colour is derived from this fill' },
  { key: 'surface', label: 'Surface', hint: 'Borders, insets and the text ramp follow it' },
  { key: 'text', label: 'Text', hint: 'Corrected if it fails 4.5:1 on the surface' },
];

/** Layer 2's own values, so the control shows what is rendering before a partner overrides it. */
const CHOICE_FIELDS = [
  {
    key: 'theme',
    label: 'Theme',
    choices: { auto: null, light: null, dark: null },
    fallback: 'auto',
    hint: 'auto follows the visitor',
  },
  {
    key: 'radius',
    label: 'Radius',
    choices: RADIUS_SCALES,
    fallback: 'soft',
    hint: 'Cards and panels; pills stay round',
  },
  {
    key: 'font',
    label: 'Font',
    choices: FONT_STACKS,
    fallback: 'inter',
    hint: 'Faces already loaded or on the system',
  },
  {
    key: 'density',
    label: 'Density',
    choices: DENSITIES,
    fallback: 'comfortable',
    hint: 'compact gives a shorter iframe',
  },
] as const satisfies readonly {
  key: keyof Brand;
  label: string;
  choices: object;
  fallback: string;
  hint: string;
}[];

/**
 * Demo-page control for the theme API. Every control writes the same brand state the query string
 * carries, so a visitor styles the widget here and the `embed.html` snippet is already the answer —
 * which is why it lives on the page rather than in a docs table.
 *
 * Always open, and sitting above the snippet it drives. It was a popover first: anything that drops
 * out of the header covers the code panel, and anything that expands in flow walks the whole stage
 * down the page on a click.
 */
export function BrandBar({ controls }: { controls: BrandControls }) {
  const { brand, notes, isBranded, update, reset } = controls;

  return (
    <section className="brand-card card">
      <header className="brand-head">
        <h3 className="brand-title">Theme &amp; brand</h3>
        <button type="button" className="btn brand-reset" onClick={reset} disabled={!isBranded}>
          Reset to SODAX
        </button>
      </header>

      <p className="brand-lead small">
        Query parameters on the <code>embed.html</code> snippet below. Set accent and surface — the button label and
        text ramp are derived to stay readable.
      </p>

      <div className="brand-grid">
        {COLOR_FIELDS.map(field => (
          <label className="brand-cell" key={field.key} title={field.hint}>
            <span className="brand-label">{field.label}</span>
            <span className="brand-control">
              <input
                type="color"
                className="brand-swatch"
                aria-label={field.label}
                value={brand[field.key] ?? BRAND_DEFAULTS[field.key]}
                onChange={event => update(field.key, readBrandField(field.key, event.target.value))}
              />
              <code className="brand-value">{brand[field.key]?.slice(1) ?? 'default'}</code>
              {brand[field.key] && (
                <button
                  type="button"
                  className="btn brand-clear"
                  onClick={() => update(field.key, undefined)}
                  aria-label={`Clear ${field.label.toLowerCase()}`}
                >
                  Clear
                </button>
              )}
            </span>
          </label>
        ))}

        {CHOICE_FIELDS.map(field => (
          <label className="brand-cell" key={field.key} title={field.hint}>
            <span className="brand-label">{field.label}</span>
            <select
              className="select"
              value={brand[field.key] ?? field.fallback}
              onChange={event => update(field.key, readBrandField(field.key, event.target.value))}
            >
              {Object.keys(field.choices).map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {notes.length > 0 && (
        <ul className="brand-notes small">
          {notes.map(note => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
