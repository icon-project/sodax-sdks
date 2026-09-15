import { describe, expect, it } from 'vitest';
import {
  type Brand,
  NO_BRAND,
  RADIUS_SCALES,
  type RadiusChoice,
  brandStyles,
  contrast,
  readBrand,
  writeBrand,
} from './brand';
import { PRESETS, activePreset } from './presets';

const AA_TEXT = 4.5;

describe('PRESETS', () => {
  it('gives every preset a distinct id', () => {
    expect(new Set(PRESETS.map(preset => preset.id)).size).toBe(PRESETS.length);
  });

  // The point of a preset shelf is five recognisably different products, not one widget in five
  // colours — so type and shape have to carry difference too, not just the palette.
  it('gives every preset its own font', () => {
    expect(new Set(PRESETS.map(preset => preset.brand.font)).size).toBe(PRESETS.length);
  });

  it.each([
    ['accent', (brand: Brand) => brand.accent],
    ['surface', (brand: Brand) => brand.surface],
  ] as const)('gives every preset its own %s', (_label, read) => {
    expect(new Set(PRESETS.map(preset => read(preset.brand))).size).toBe(PRESETS.length);
  });

  it('separates any two presets by more than colour alone', () => {
    for (const a of PRESETS) {
      for (const b of PRESETS) {
        if (a.id >= b.id) continue;
        const shape = [
          a.brand.font !== b.brand.font,
          a.brand.radius !== b.brand.radius,
          a.brand.theme !== b.brand.theme,
        ];
        expect(shape.filter(Boolean).length, `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  // A spec that misspells a key or a choice parses to `undefined` rather than failing, so the
  // suite has to be what catches it.
  it.each(PRESETS)('$id fills every brand field', preset => {
    for (const [key, value] of Object.entries(preset.brand)) {
      expect(value, key).toBeDefined();
    }
  });

  it.each(PRESETS)('$id survives the round trip an embed link makes', preset => {
    const params = new URLSearchParams();
    writeBrand(params, preset.brand);
    expect(readBrand(params.toString())).toEqual(preset.brand);
  });

  // The point of shipping these: a visitor clicking one gets a readable widget, not a correction
  // note telling them the palette we picked failed.
  it.each(PRESETS)('$id derives without a contrast correction', preset => {
    expect(brandStyles(preset.brand).notes).toEqual([]);
  });

  it.each(PRESETS)('$id keeps its button label readable on the fill', preset => {
    const { decls } = declarations(preset.brand);
    expect(contrast(decls['--cta-fg'], decls['--cta-bg'])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(PRESETS)('$id keeps body copy readable on the surface', preset => {
    const { decls } = declarations(preset.brand);
    expect(contrast(decls['--text-body'], decls['--surface-card'])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // The loudest shape in the widget. A preset that sets a radius but leaves buttons as pills is
  // the bug that made every palette read as the same product.
  it.each(PRESETS)('$id reshapes its buttons with the rest of the scale', preset => {
    const { decls } = declarations(preset.brand);
    expect(decls['--radius-pill']).toBe(RADIUS_SCALES[preset.brand.radius as RadiusChoice].pill);
  });
});

describe('activePreset', () => {
  it('matches the preset a brand was applied from', () => {
    for (const preset of PRESETS) {
      expect(activePreset(preset.brand)?.id).toBe(preset.id);
    }
  });

  it('drops the match once a single field moves', () => {
    const [first] = PRESETS;
    expect(activePreset({ ...first.brand, accent: '#ff0000' })).toBeUndefined();
  });

  it('matches nothing for an unbranded widget', () => {
    expect(activePreset(NO_BRAND)).toBeUndefined();
  });
});

/** The emitted `:root` block as a record, so a test can read a single derived role. */
function declarations(brand: Brand): { decls: Record<string, string> } {
  const [root] = brandStyles(brand).css.split('\n\n');
  const decls = Object.fromEntries(
    root
      .split('\n')
      .slice(1, -1)
      .map(line => {
        const [name, value] = line.trim().replace(/;$/, '').split(': ');
        return [name, value];
      }),
  );
  return { decls };
}
