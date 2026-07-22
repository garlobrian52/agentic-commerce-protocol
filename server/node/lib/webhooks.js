'use strict';

/**
 * Handle Stripe webhook events from the Accounts v2 blueprint flows.
 *
 * Expected events:
 * - v2.core.account[configuration.merchant].capability_status_updated (thin)
 * - checkout.session.completed (snapshot)
 * - invoice.payment_succeeded (snapshot)
 */
function createWebhookHandler({ store, onEvent } = {}) {
  return async function handleWebhookEvent(event) {
    const type = event.type || event?.data?.object?.object;
    const payload = event.data?.object || event;

    if (typeof onEvent === 'function') {
      await onEvent(event);
    }

    switch (event.type) {
      case 'v2.core.account[configuration.merchant].capability_status_updated': {
        const accountId =
          payload.id ||
          payload.related_object?.id ||
          event.related_object?.id ||
          null;
        if (accountId && store) {
          const seller = store.findByAccountId(accountId);
          if (seller) {
            store.upsertSeller(seller.id, {
              merchantCapabilityUpdatedAt: new Date().toISOString(),
              lastWebhookEvent: event.type,
            });
          }
        }
        break;
      }
      case 'checkout.session.completed': {
        const accountId =
          event.account ||
          payload.metadata?.account_id ||
          null;
        if (store && accountId) {
          const seller = store.findByAccountId(accountId);
          if (seller) {
            store.upsertSeller(seller.id, {
              lastCheckoutSessionId: payload.id,
              lastPaymentStatus: payload.payment_status,
              lastWebhookEvent: event.type,
            });
          }
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const accountId = payload.customer_account || null;
        const subscriptionId =
          typeof payload.subscription === 'string'
            ? payload.subscription
            : payload.subscription?.id || null;
        if (store && accountId) {
          const seller = store.findByAccountId(accountId);
          if (seller) {
            store.upsertSeller(seller.id, {
              subscriptionId: subscriptionId || seller.subscriptionId,
              lastInvoiceId: payload.id,
              subscriptionStatus: 'active',
              lastWebhookEvent: event.type,
            });
          }
        }
        break;
      }
      default:
        break;
    }

    return { received: true, type: event.type };
  };
}

module.exports = { createWebhookHandler };
