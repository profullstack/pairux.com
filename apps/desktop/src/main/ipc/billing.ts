/**
 * IPC handlers for billing / entitlements (paid multistream plugin).
 */

import { ipcMain } from 'electron';
import { getPlan } from '../billing/entitlement';
import { isPaidPlan } from '../../shared/entitlements';

export function registerBillingHandlers(): void {
  console.log('[IPC:Billing] Registering billing handlers');

  ipcMain.handle('billing:getPlan', async (_event, args?: { forceRefresh?: boolean }) => {
    const plan = await getPlan(args?.forceRefresh ?? false);
    return { plan, paidUnlocked: isPaidPlan(plan) };
  });

  console.log('[IPC:Billing] Billing handlers registered');
}
