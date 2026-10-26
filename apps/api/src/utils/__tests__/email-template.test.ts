import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMAIL_TEMPLATE_BRANDING,
  MAX_BRAND_NAME_LENGTH,
  MAX_FOOTER_TEXT_LENGTH,
  normalizeEmailTemplateColor,
  normalizeEmailTemplateLogoUrl,
  normalizeEmailTemplatePreferences,
  parseStoredEmailTemplate,
} from '../email-template';

describe('normalizeEmailTemplateColor', () => {
  it('expands 3-digit shorthand and lowercases the result', () => {
    expect(normalizeEmailTemplateColor('#F80', 'primaryColor')).toBe('#ff8800');
    expect(normalizeEmailTemplateColor('ABCdef', 'accentColor')).toBe('#abcdef');
  });

  it('rejects non-hex values', () => {
    expect(() => normalizeEmailTemplateColor('blue', 'primaryColor')).toThrow(
      /must be a hex color/,
    );
    expect(() => normalizeEmailTemplateColor('#12345', 'primaryColor')).toThrow(
      /must be a hex color/,
    );
  });
});

describe('normalizeEmailTemplateLogoUrl', () => {
  it('treats an empty value as the monogram fallback', () => {
    expect(normalizeEmailTemplateLogoUrl('')).toBe('');
    expect(normalizeEmailTemplateLogoUrl('   ')).toBe('');
  });

  it('accepts absolute https URLs', () => {
    expect(normalizeEmailTemplateLogoUrl('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png',
    );
  });

  it('rejects non-https and data/javaScript schemes', () => {
    expect(() => normalizeEmailTemplateLogoUrl('http://cdn.example.com/logo.png')).toThrow(
      /must use https/,
    );
    expect(() => normalizeEmailTemplateLogoUrl('javascript:alert(1)')).toThrow(
      /must use https/,
    );
    expect(() => normalizeEmailTemplateLogoUrl('data:image/png;base64,abc')).toThrow(
      /must use https/,
    );
  });

  it('rejects relative URLs', () => {
    expect(() => normalizeEmailTemplateLogoUrl('/logo.png')).toThrow(/absolute https URL/);
  });
});

describe('normalizeEmailTemplatePreferences', () => {
  it('applies the platform defaults for a missing template', () => {
    expect(normalizeEmailTemplatePreferences({})).toEqual(DEFAULT_EMAIL_TEMPLATE_BRANDING);
  });

  it('normalizes a full branded template', () => {
    expect(
      normalizeEmailTemplatePreferences({
        brandName: '  Northwind Goods  ',
        logoUrl: 'https://cdn.example.com/logo.png',
        primaryColor: '#0A5',
        accentColor: '#ABCDEF',
        footerText: '  Thanks for your business.  ',
      }),
    ).toEqual({
      brandName: 'Northwind Goods',
      logoUrl: 'https://cdn.example.com/logo.png',
      primaryColor: '#00aa55',
      accentColor: '#abcdef',
      footerText: 'Thanks for your business.',
    });
  });

  it('rejects arrays, primitives and empty brand names', () => {
    expect(() => normalizeEmailTemplatePreferences([])).toThrow(/must be an object/);
    expect(() => normalizeEmailTemplatePreferences('brand')).toThrow(/must be an object/);
    expect(() => normalizeEmailTemplatePreferences({ brandName: '   ' })).toThrow(
      /brandName must not be empty/,
    );
  });

  it('rejects non-string field types', () => {
    expect(() => normalizeEmailTemplatePreferences({ brandName: 42 })).toThrow(
      /brandName must be a string/,
    );
  });

  it('enforces the branding length caps', () => {
    expect(() =>
      normalizeEmailTemplatePreferences({ brandName: 'a'.repeat(MAX_BRAND_NAME_LENGTH + 1) }),
    ).toThrow(/brandName must be at most/);
    expect(() =>
      normalizeEmailTemplatePreferences({ footerText: 'a'.repeat(MAX_FOOTER_TEXT_LENGTH + 1) }),
    ).toThrow(/footerText must be at most/);
  });

  it('keeps the provided primary color while defaulting the accent', () => {
    const template = normalizeEmailTemplatePreferences({ primaryColor: '#123456' });
    expect(template.primaryColor).toBe('#123456');
    expect(template.accentColor).toBe(DEFAULT_EMAIL_TEMPLATE_BRANDING.accentColor);
  });
});

describe('parseStoredEmailTemplate', () => {
  it('returns null for missing, non-object and malformed rows', () => {
    expect(parseStoredEmailTemplate(null)).toBeNull();
    expect(parseStoredEmailTemplate('brand')).toBeNull();
    expect(parseStoredEmailTemplate([])).toBeNull();
    expect(parseStoredEmailTemplate({ primaryColor: 'not-a-color' })).toBeNull();
  });

  it('normalizes a valid stored row', () => {
    expect(
      parseStoredEmailTemplate({
        brandName: 'Northwind Goods',
        logoUrl: '',
        primaryColor: '#123',
        accentColor: '#abcdef',
        footerText: 'Thanks!',
      }),
    ).toEqual({
      brandName: 'Northwind Goods',
      logoUrl: '',
      primaryColor: '#112233',
      accentColor: '#abcdef',
      footerText: 'Thanks!',
    });
  });
});
