import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  EmailTemplatePreview,
  DEFAULT_EMAIL_TEMPLATE,
  buildEmailTemplateHtml,
  normalizeHexColor,
} from './EmailTemplatePreview';

describe('EmailTemplatePreview', () => {
  it('renders the branding editor controls and a live email preview frame', () => {
    render(<EmailTemplatePreview />);

    expect(screen.getByRole('heading', { name: /Email Receipt Template/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Brand Name/i)).toHaveValue(DEFAULT_EMAIL_TEMPLATE.brandName);
    expect(screen.getByLabelText(/Brand Logo URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Primary Color/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Accent Color/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Footer Note/i)).toBeInTheDocument();
    expect(screen.getByTestId('email-preview-frame')).toBeInTheDocument();
  });

  it('builds email HTML that reflects custom brand logo and colors', () => {
    const html = buildEmailTemplateHtml({
      ...DEFAULT_EMAIL_TEMPLATE,
      brandName: 'Northwind Goods',
      logoUrl: 'https://cdn.example.com/northwind-logo.png',
      primaryColor: '#123456',
      accentColor: '#abcdef',
    });

    expect(html).toContain('Northwind Goods');
    expect(html).toContain('https://cdn.example.com/northwind-logo.png');
    expect(html).toContain('#123456');
    expect(html).toContain('#abcdef');
    expect(html).toContain(DEFAULT_EMAIL_TEMPLATE.amount);
    expect(html).toContain(DEFAULT_EMAIL_TEMPLATE.asset);
  });

  it('falls back to a monogram when no logo URL is provided', () => {
    const html = buildEmailTemplateHtml({ ...DEFAULT_EMAIL_TEMPLATE, logoUrl: '' });
    expect(html).not.toContain('<img src=');
  });

  it('normalizes malformed hex colors to a safe default', () => {
    expect(normalizeHexColor('zzz')).toBe('#0ea5e9');
    expect(normalizeHexColor('#f80')).toBe('#ff8800');
    expect(normalizeHexColor('  #0EA5E9  ')).toBe('#0ea5e9');
  });

  it('invokes onSaveTemplate with the customized template variables', async () => {
    const onSaveTemplate = vi.fn().mockResolvedValue(undefined);
    render(<EmailTemplatePreview onSaveTemplate={onSaveTemplate} />);

    fireEvent.change(screen.getByLabelText(/Brand Name/i), {
      target: { value: 'Acme Coffee' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));

    expect(onSaveTemplate).toHaveBeenCalledTimes(1);
    expect(onSaveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ brandName: 'Acme Coffee' })
    );
    expect(await screen.findByText('✓ Saved')).toBeInTheDocument();
  });

  it('updates the live preview HTML when branding changes', () => {
    render(<EmailTemplatePreview />);

    fireEvent.change(screen.getByLabelText(/Brand Name/i), {
      target: { value: 'Acme Coffee' },
    });
    fireEvent.change(screen.getByLabelText(/Brand Logo URL/i), {
      target: { value: 'https://cdn.example.com/acme.png' },
    });

    const frame = screen.getByTestId('email-preview-frame');
    const srcDoc = frame.getAttribute('srcdoc') ?? (frame as HTMLIFrameElement).srcdoc;

    expect(srcDoc).toContain('Acme Coffee');
    expect(srcDoc).toContain('https://cdn.example.com/acme.png');
  });

  it('opens the preview modal and closes it via the close button', () => {
    render(<EmailTemplatePreview />);

    expect(screen.queryByTestId('email-preview-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('email-preview-modal-frame')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Close preview/i }));

    expect(screen.queryByTestId('email-preview-modal')).not.toBeInTheDocument();
  });

  it('closes the preview modal on Escape and on backdrop click', () => {
    render(<EmailTemplatePreview />);

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('email-preview-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }));
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByTestId('email-preview-modal')).not.toBeInTheDocument();
  });

  it('switches the modal preview between desktop and mobile widths', () => {
    render(<EmailTemplatePreview />);

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }));
    const mobileToggle = screen.getByRole('button', { name: /^Mobile$/i });
    fireEvent.click(mobileToggle);

    expect(mobileToggle).toHaveAttribute('aria-pressed', 'true');
    const modalFrame = screen.getByTestId('email-preview-modal-frame');
    expect(modalFrame).toHaveStyle({ width: '390px' });
  });

  it('hydrates the editor from a saved template', async () => {
    render(
      <EmailTemplatePreview
        initialTemplate={{
          brandName: 'Hydrated Co',
          primaryColor: '#112233',
          accentColor: '#445566',
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/Brand Name/i)).toHaveValue('Hydrated Co'),
    );

    const frame = screen.getByTestId('email-preview-frame');
    const srcDoc = frame.getAttribute('srcdoc') ?? (frame as HTMLIFrameElement).srcdoc;
    expect(srcDoc).toContain('#112233');
    expect(srcDoc).toContain('#445566');
  });

  it('shows the API error instead of a false saved confirmation', async () => {
    const onSaveTemplate = vi
      .fn()
      .mockRejectedValue(new Error('emailTemplate.logoUrl must use https.'));

    render(<EmailTemplatePreview onSaveTemplate={onSaveTemplate} />);

    fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('emailTemplate.logoUrl must use https.');
    expect(screen.queryByText('✓ Saved')).not.toBeInTheDocument();
  });
});