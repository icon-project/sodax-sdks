import { describe, expect, it } from 'vitest';
import { formatTokenAmount } from './format';

describe('formatTokenAmount', () => {
  it('leaves a whole number alone', () => {
    expect(formatTokenAmount('1000')).toBe('1000');
  });

  it('caps a readable amount at six decimals', () => {
    expect(formatTokenAmount('0.399115630295772533')).toBe('0.399115');
  });

  it('drops trailing zeros rather than padding to the cap', () => {
    expect(formatTokenAmount('1.500000000000000000')).toBe('1.5');
  });

  it('drops the decimal point when the fraction trims away entirely', () => {
    expect(formatTokenAmount('42.000000000000000001')).toBe('42');
  });

  // Truncating keeps a displayed output or minimum from ever reading higher than the real one.
  it('truncates rather than rounds', () => {
    expect(formatTokenAmount('0.9999999')).toBe('0.999999');
  });

  // Six decimal *places* would render an 18-decimal dust amount as 0 — six significant digits does not.
  it('keeps significant digits on a dust amount', () => {
    expect(formatTokenAmount('0.000000000123456789')).toBe('0.000000000123456');
  });

  it('is unchanged for an amount already shorter than the cap', () => {
    expect(formatTokenAmount('0.5')).toBe('0.5');
  });

  it('honours a caller-supplied precision', () => {
    expect(formatTokenAmount('0.123456789', 2)).toBe('0.12');
  });

  it('passes an empty string through rather than throwing', () => {
    expect(formatTokenAmount('')).toBe('');
  });
});
