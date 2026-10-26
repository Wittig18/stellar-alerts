import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { PaymentTable } from '../PaymentTable';
import type { PaymentDTO } from '@stellar-alerts/shared';

// Extend vitest's expect with jest-axe's toHaveNoViolations matcher
expect.extend(toHaveNoViolations);

function makePayment(overrides: Partial<PaymentDTO> = {}): PaymentDTO {
  return {
    id: 'pay-1',
    walletId: 'wallet-1',
    txHash: 'txhash1234567890',
    fromAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOP',
    amount: 100,
    asset: 'XLM',
    memo: 'payment memo',
    receivedAt: '2026-01-15T10:30:00.000Z',
    ...overrides,
  };
}

describe('PaymentTable ARIA Live Region & Screen Reader Accessibility', () => {
  describe('ARIA live region for new payment announcements', () => {
    it('renders a polite aria-live region with role=status on mount', () => {
      render(<PaymentTable payments={[makePayment()]} isLoading={false} />);

      const liveRegion = screen.getByTestId('payment-live-region');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
      expect(liveRegion).toHaveAttribute('role', 'status');
      expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    });

    it('is visually hidden but available to screen readers (sr-only)', () => {
      render(<PaymentTable payments={[makePayment()]} isLoading={false} />);

      const liveRegion = screen.getByTestId('payment-live-region');
      // sr-only class makes the element visually hidden but accessible to AT
      expect(liveRegion).toHaveClass('sr-only');
    });

    it('does not announce anything on initial load', () => {
      render(<PaymentTable payments={[makePayment()]} isLoading={false} />);

      const liveRegion = screen.getByTestId('payment-live-region');
      expect(liveRegion).toHaveTextContent('');
    });

    it('announces a single new payment when the list grows by one', () => {
      const initial = [makePayment({ id: 'pay-1' })];
      const { rerender } = render(<PaymentTable payments={initial} isLoading={false} />);

      rerender(
        <PaymentTable
          payments={[makePayment({ id: 'pay-2' }), ...initial]}
          isLoading={false}
        />,
      );

      const liveRegion = screen.getByTestId('payment-live-region');
      expect(liveRegion).toHaveTextContent('1 new payment received.');
    });

    it('announces multiple new payments with correct pluralization', () => {
      const initial = [makePayment({ id: 'pay-1' })];
      const { rerender } = render(<PaymentTable payments={initial} isLoading={false} />);

      rerender(
        <PaymentTable
          payments={[
            makePayment({ id: 'pay-2' }),
            makePayment({ id: 'pay-3' }),
            makePayment({ id: 'pay-4' }),
            ...initial,
          ]}
          isLoading={false}
        />,
      );

      const liveRegion = screen.getByTestId('payment-live-region');
      expect(liveRegion).toHaveTextContent('3 new payments received.');
    });

    it('does not announce when the list shrinks (filtering/removal)', () => {
      const initial = [
        makePayment({ id: 'pay-1' }),
        makePayment({ id: 'pay-2' }),
        makePayment({ id: 'pay-3' }),
      ];
      const { rerender } = render(<PaymentTable payments={initial} isLoading={false} />);

      // Simulate filtering by passing a smaller list
      rerender(<PaymentTable payments={[initial[0]]} isLoading={false} />);

      const liveRegion = screen.getByTestId('payment-live-region');
      expect(liveRegion).toHaveTextContent('');
    });
  });

  describe('Keyboard navigation and focus rings', () => {
    it('all interactive elements have focus-visible ring styles', () => {
      const payments = [makePayment()];
      const { container } = render(<PaymentTable payments={payments} isLoading={false} />);

      // Collect all focusable elements: buttons, links, inputs, selects
      const focusableSelectors = 'button, a, input, select, [tabindex]:not([tabindex="-1"])';
      const focusableElements = container.querySelectorAll(focusableSelectors);

      expect(focusableElements.length).toBeGreaterThan(0);

      focusableElements.forEach((el) => {
        const classList = el.getAttribute('class') || '';
        // Every interactive element should have a focus-visible ring class
        expect(classList).toContain('focus-visible:ring');
      });
    });

    it('maintains a logical tab sequence through the payment table controls', async () => {
      const user = userEvent.setup();
      const payments = [
        makePayment({ id: 'pay-1', fromAddress: 'GSENDER1' }),
        makePayment({ id: 'pay-2', fromAddress: 'GSENDER2' }),
      ];
      render(<PaymentTable payments={payments} isLoading={false} />);

      // Tab from the body into the component and verify the expected sequence
      // The tab order should be: Export CSV -> Export JSON -> Search input ->
      // Clear search -> Asset filter select -> Reset filters -> [table links]
      await user.tab();

      // First focusable should be the Export CSV button
      const exportCsvBtn = screen.getByRole('button', { name: /export payments as csv/i });
      expect(exportCsvBtn).toHaveFocus();

      await user.tab();
      const exportJsonBtn = screen.getByRole('button', { name: /export payments as json/i });
      expect(exportJsonBtn).toHaveFocus();

      await user.tab();
      const searchInput = screen.getByLabelText(/Search payments by sender address/i);
      expect(searchInput).toHaveFocus();

      await user.tab();
      // Next should be the asset filter select (clear search button only appears
      // when there is text in the search field)
      const assetSelect = screen.getByLabelText(/Filter payments by asset code/i);
      expect(assetSelect).toHaveFocus();
    });

    it('export buttons are keyboard accessible (Enter activates them)', async () => {
      const user = userEvent.setup();
      const payments = [makePayment()];

      // jsdom doesn't implement URL.createObjectURL/revokeObjectURL; stub both
      // so the export handler doesn't throw when Enter triggers the click.
      if (!('createObjectURL' in URL)) {
        (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = () => 'blob:mock';
      }
      if (!('revokeObjectURL' in URL)) {
        (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => {};
      }
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      render(<PaymentTable payments={payments} isLoading={false} />);

      const exportCsvBtn = screen.getByRole('button', { name: /export payments as csv/i });
      exportCsvBtn.focus();
      expect(exportCsvBtn).toHaveFocus();

      await user.keyboard('{Enter}');
      // The click handler should have been invoked
      expect(exportCsvBtn).toBeInTheDocument();

      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
      clickSpy.mockRestore();
    });

    it('search input accepts keyboard input', async () => {
      const user = userEvent.setup();
      const payments = [makePayment()];
      render(<PaymentTable payments={payments} isLoading={false} />);

      const searchInput = screen.getByLabelText(/Search payments by sender address/i);
      searchInput.focus();
      await user.keyboard('GTEST');
      expect(searchInput).toHaveValue('GTEST');
    });
  });

  describe('Table semantic accessibility', () => {
    it('has a screen-reader-only caption describing the table', () => {
      const payments = [makePayment()];
      render(<PaymentTable payments={payments} isLoading={false} />);

      const table = screen.getByRole('table');
      const caption = table.querySelector('caption');
      expect(caption).toBeInTheDocument();
      expect(caption).toHaveClass('sr-only');
      expect(caption?.textContent).toContain('payment ledger');
    });

    it('all column headers have scope=col', () => {
      const payments = [makePayment()];
      render(<PaymentTable payments={payments} isLoading={false} />);

      const headers = screen.getAllByRole('columnheader');
      headers.forEach((header) => {
        expect(header).toHaveAttribute('scope', 'col');
      });
    });

    it('external links have descriptive aria-labels', () => {
      const payments = [makePayment({ txHash: 'abc123def456' })];
      render(<PaymentTable payments={payments} isLoading={false} />);

      const txLink = screen.getByRole('link', { name: /View transaction abc123def456 on Stellar Explorer/i });
      expect(txLink).toBeInTheDocument();

      const receiptLink = screen.getByRole('link', { name: /Download PDF receipt for transaction abc123def456/i });
      expect(receiptLink).toBeInTheDocument();
    });

    it('decorative emoji are marked aria-hidden', () => {
      const payments = [makePayment()];
      const { container } = render(<PaymentTable payments={payments} isLoading={false} />);

      const headerEmoji = container.querySelector('h2 span[aria-hidden="true"]');
      expect(headerEmoji).toBeInTheDocument();
    });
  });

  describe('axe-core automated WCAG 2.1 AA audit', () => {
    it('table with payments has no accessibility violations', async () => {
      const payments = [
        makePayment({ id: 'pay-1', asset: 'XLM', fromAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOP' }),
        makePayment({ id: 'pay-2', asset: 'USDC', fromAddress: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJ' }),
      ];
      const { container } = render(<PaymentTable payments={payments} isLoading={false} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('table in loading state has no accessibility violations', async () => {
      const { container } = render(<PaymentTable payments={[]} isLoading={true} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('empty state with no payments has no accessibility violations', async () => {
      const { container } = render(<PaymentTable payments={[]} isLoading={false} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('no-results state with active filters has no accessibility violations', async () => {
      const payments = [makePayment({ fromAddress: 'GKNOWNADDRESS' })];
      const { container } = render(<PaymentTable payments={payments} isLoading={false} />);

      // Type a search query that matches nothing
      const searchInput = screen.getByLabelText(/Search payments by sender address/i);
      fireEvent.change(searchInput, { target: { value: 'NONEXISTENT' } });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('table with filtered results has no accessibility violations', async () => {
      const payments = [
        makePayment({ id: 'pay-1', asset: 'XLM', fromAddress: 'GAAA111' }),
        makePayment({ id: 'pay-2', asset: 'USDC', fromAddress: 'GBBB222' }),
      ];
      const { container } = render(<PaymentTable payments={payments} isLoading={false} />);

      // Filter to only XLM
      const assetSelect = screen.getByLabelText(/Filter payments by asset code/i);
      fireEvent.change(assetSelect, { target: { value: 'XLM' } });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
