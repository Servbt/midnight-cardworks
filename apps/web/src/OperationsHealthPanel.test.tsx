import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationsHealthPanel } from './OperationsHealthPanel';
const health = { checkedAt: '2026-09-21T10:00:00Z', attentionCount: 1, waitingCount: 1, items: [
  { id: 'payment:a', orderId: 'ord_a', category: 'payment', status: 'attention', title: 'Unresolved refund request', detail: 'Reconcile Stripe before retrying.' },
  { id: 'hold:b', orderId: 'ord_b', category: 'inventory', status: 'waiting', title: 'Stock held for checkout', detail: 'Recovery checks Stripe automatically.' }
] };
const response = (value = health) => new Response(JSON.stringify(value), { status: 200 });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('loads an authenticated snapshot, filters categories and opens orders without triggering mutations', async () => {
  const request = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', request); const open = vi.fn();
  render(<OperationsHealthPanel getToken={async () => 'admin'} onReviewOrders={open} />);
  expect(await screen.findByText('1 need attention')).toBeInTheDocument();
  expect(screen.getByText('1 waiting')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(expect.stringContaining('/api/admin/operations-health'), expect.objectContaining({ headers: { authorization: 'Bearer admin' }, cache: 'no-store' }));
  await userEvent.selectOptions(screen.getByLabelText('Show items'), 'inventory');
  expect(screen.queryByText('Unresolved refund request')).not.toBeInTheDocument();
  expect(screen.getByText('Stock held for checkout')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Review orders' })); expect(open).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledTimes(1);
});
it('does not display a successful old snapshot when refresh fails and permits recovery', async () => {
  const request = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(response({ ...health, attentionCount: 0, waitingCount: 0, items: [] }));
  vi.stubGlobal('fetch', request); render(<OperationsHealthPanel getToken={async () => 'admin'} onReviewOrders={() => {}} />);
  await screen.findByText('1 need attention'); await userEvent.click(screen.getByRole('button', { name: 'Refresh health' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable'); expect(screen.queryByText('1 need attention')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh health' }));
  expect(await screen.findByText('No outstanding items in this snapshot.')).toBeInTheDocument();
});
it('does not request data without an admin token and aborts an in-flight request when closed', async () => {
  const request = vi.fn().mockImplementation(() => new Promise(() => {})); vi.stubGlobal('fetch', request);
  const first = render(<OperationsHealthPanel getToken={async () => undefined} onReviewOrders={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again'); expect(request).not.toHaveBeenCalled(); first.unmount();
  const second = render(<OperationsHealthPanel getToken={async () => 'admin'} onReviewOrders={() => {}} />);
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  const signal = request.mock.calls[0][1].signal as AbortSignal; second.unmount(); expect(signal.aborted).toBe(true);
});
