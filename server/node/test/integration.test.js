'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SellerStore } = require('../lib/store');
const { createAccount, createAccountLink } = require('../lib/accounts');
const { createCheckoutSession } = require('../lib/payments');
const {
  createSubscriptionProduct,
  createBalanceSetupIntent,
  createAccountSubscription,
  chargeAccountSubscription,
} = require('../lib/subscriptions');
const { createWebhookHandler } = require('../lib/webhooks');

function createMockStripe(handlers = {}) {
  return {
    v2: {
      core: {
        accounts: {
          create: handlers.createAccount || (async (params) => ({
            id: 'acct_test_123',
            object: 'v2.core.account',
            display_name: params.display_name,
            contact_email: params.contact_email,
            configuration: params.configuration,
            include: params.include,
          })),
        },
        accountLinks: {
          create: handlers.createAccountLink || (async (params) => ({
            id: 'alink_test_123',
            object: 'v2.core.account_link',
            account: params.account,
            url: 'https://connect.stripe.com/setup/test',
            use_case: params.use_case,
          })),
        },
      },
    },
    checkout: {
      sessions: {
        create: handlers.createCheckoutSession || (async (params, options) => ({
          id: 'cs_test_123',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_test_123',
          mode: params.mode,
          payment_intent_data: params.payment_intent_data,
          stripeAccount: options?.stripeAccount,
        })),
      },
    },
    products: {
      create: handlers.createProduct || (async (params) => ({
        id: 'prod_test_123',
        object: 'product',
        name: params.name,
        default_price: {
          id: 'price_test_123',
          object: 'price',
          unit_amount: params.default_price_data.unit_amount,
          recurring: params.default_price_data.recurring,
        },
      })),
    },
    setupIntents: {
      create: handlers.createSetupIntent || (async (params) => ({
        id: 'seti_test_123',
        object: 'setup_intent',
        customer_account: params.customer_account,
        payment_method: 'pm_balance_test_123',
        status: 'succeeded',
      })),
    },
    subscriptions: {
      create: handlers.createSubscription || (async (params) => ({
        id: 'sub_test_123',
        object: 'subscription',
        customer_account: params.customer_account,
        default_payment_method: params.default_payment_method,
        status: 'active',
        items: { data: params.items },
      })),
    },
  };
}

describe('SellerStore', () => {
  let tmpFile;
  let store;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `sellers-${Date.now()}-${Math.random()}.json`);
    store = new SellerStore(tmpFile);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('persists and retrieves Stripe identifiers for a seller', () => {
    store.upsertSeller('seller_1', {
      accountId: 'acct_123',
      subscriptionId: 'sub_123',
      priceId: 'price_123',
    });

    const seller = store.getSeller('seller_1');
    assert.equal(seller.accountId, 'acct_123');
    assert.equal(seller.subscriptionId, 'sub_123');
    assert.equal(store.findByAccountId('acct_123').id, 'seller_1');
  });
});

describe('Accounts v2 API helpers', () => {
  it('createAccount sends merchant + customer configuration and include list', async () => {
    let captured;
    const stripe = createMockStripe({
      createAccount: async (params) => {
        captured = params;
        return { id: 'acct_1', ...params };
      },
    });

    const account = await createAccount(stripe, {
      displayName: 'Test account',
      contactEmail: 'testaccount@example.com',
      country: 'US',
    });

    assert.equal(account.id, 'acct_1');
    assert.equal(captured.display_name, 'Test account');
    assert.equal(captured.contact_email, 'testaccount@example.com');
    assert.equal(captured.dashboard, 'full');
    assert.equal(captured.identity.country, 'US');
    assert.equal(captured.defaults.responsibilities.fees_collector, 'stripe');
    assert.equal(captured.defaults.responsibilities.losses_collector, 'stripe');
    assert.equal(captured.configuration.merchant.simulate_accept_tos_obo, true);
    assert.ok(captured.configuration.customer);
    assert.deepEqual(captured.include, [
      'configuration.merchant',
      'configuration.recipient',
      'identity',
      'defaults',
      'configuration.customer',
    ]);
  });

  it('createAccountLink reuses the connected account id and merchant/customer configs', async () => {
    let captured;
    const stripe = createMockStripe({
      createAccountLink: async (params) => {
        captured = params;
        return { id: 'alink_1', url: 'https://example.com/onboard', ...params };
      },
    });

    const link = await createAccountLink(stripe, {
      accountId: 'acct_1',
      returnUrl: 'https://example.com/return',
      refreshUrl: 'https://example.com/refresh',
    });

    assert.equal(link.account, 'acct_1');
    assert.equal(captured.account, 'acct_1');
    assert.equal(captured.use_case.type, 'account_onboarding');
    assert.deepEqual(captured.use_case.account_onboarding.configurations, [
      'merchant',
      'customer',
    ]);
  });
});

describe('Embedded payments helpers', () => {
  it('createCheckoutSession charges on the connected account with an application fee', async () => {
    let capturedParams;
    let capturedOptions;
    const stripe = createMockStripe({
      createCheckoutSession: async (params, options) => {
        capturedParams = params;
        capturedOptions = options;
        return { id: 'cs_1', url: 'https://checkout.stripe.com/test', ...params };
      },
    });

    const session = await createCheckoutSession(stripe, {
      accountId: 'acct_1',
      currency: 'usd',
      unitAmount: 100000,
      applicationFeeAmount: 123,
    });

    assert.equal(session.id, 'cs_1');
    assert.equal(capturedParams.mode, 'payment');
    assert.deepEqual(capturedParams.payment_method_types, ['card']);
    assert.equal(capturedParams.line_items[0].price_data.unit_amount, 100000);
    assert.equal(capturedParams.line_items[0].price_data.product_data.name, 'Cookie');
    assert.equal(capturedParams.payment_intent_data.application_fee_amount, 123);
    assert.equal(capturedOptions.stripeAccount, 'acct_1');
  });
});

describe('Subscription helpers', () => {
  it('creates product, balance setup intent, then subscription using prior outputs', async () => {
    const stripe = createMockStripe();
    const result = await chargeAccountSubscription(stripe, {
      accountId: 'acct_1',
      currency: 'usd',
      unitAmount: 1000,
    });

    assert.equal(result.priceId, 'price_test_123');
    assert.equal(result.setupIntent.payment_method, 'pm_balance_test_123');
    assert.equal(result.subscription.customer_account, 'acct_1');
    assert.equal(result.subscription.default_payment_method, 'pm_balance_test_123');
  });

  it('createAccountSubscription requires account, price, and payment method', async () => {
    const stripe = createMockStripe();
    await assert.rejects(
      () => createAccountSubscription(stripe, { accountId: 'acct_1' }),
      /priceId is required/
    );
  });

  it('createSubscriptionProduct uses monthly recurring default price data', async () => {
    let captured;
    const stripe = createMockStripe({
      createProduct: async (params) => {
        captured = params;
        return {
          id: 'prod_1',
          default_price: { id: 'price_1' },
          name: params.name,
        };
      },
    });

    await createSubscriptionProduct(stripe, {
      name: 'Platform subscription',
      currency: 'usd',
      unitAmount: 1000,
    });

    assert.equal(captured.name, 'Platform subscription');
    assert.equal(captured.default_price_data.currency, 'usd');
    assert.equal(captured.default_price_data.unit_amount, 1000);
    assert.equal(captured.default_price_data.recurring.interval, 'month');
  });

  it('createBalanceSetupIntent confirms stripe_balance for the account', async () => {
    let captured;
    const stripe = createMockStripe({
      createSetupIntent: async (params) => {
        captured = params;
        return { id: 'seti_1', payment_method: 'pm_1', ...params };
      },
    });

    await createBalanceSetupIntent(stripe, { accountId: 'acct_1' });

    assert.deepEqual(captured.payment_method_types, ['stripe_balance']);
    assert.equal(captured.confirm, true);
    assert.equal(captured.customer_account, 'acct_1');
    assert.equal(captured.usage, 'off_session');
    assert.equal(captured.payment_method_data.type, 'stripe_balance');
  });
});

describe('Webhook handler', () => {
  let tmpFile;
  let store;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `sellers-wh-${Date.now()}.json`);
    store = new SellerStore(tmpFile);
    store.upsertSeller('seller_1', { accountId: 'acct_1' });
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('updates seller on merchant capability status updates', async () => {
    const handle = createWebhookHandler({ store });
    await handle({
      type: 'v2.core.account[configuration.merchant].capability_status_updated',
      data: { object: { id: 'acct_1' } },
    });

    const seller = store.getSeller('seller_1');
    assert.equal(
      seller.lastWebhookEvent,
      'v2.core.account[configuration.merchant].capability_status_updated'
    );
    assert.ok(seller.merchantCapabilityUpdatedAt);
  });

  it('records checkout.session.completed against the connected account', async () => {
    const handle = createWebhookHandler({ store });
    await handle({
      type: 'checkout.session.completed',
      account: 'acct_1',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
        },
      },
    });

    const seller = store.getSeller('seller_1');
    assert.equal(seller.lastCheckoutSessionId, 'cs_123');
    assert.equal(seller.lastPaymentStatus, 'paid');
  });

  it('records invoice.payment_succeeded for account subscriptions', async () => {
    const handle = createWebhookHandler({ store });
    await handle({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_123',
          customer_account: 'acct_1',
          subscription: 'sub_123',
        },
      },
    });

    const seller = store.getSeller('seller_1');
    assert.equal(seller.subscriptionId, 'sub_123');
    assert.equal(seller.subscriptionStatus, 'active');
    assert.equal(seller.lastInvoiceId, 'in_123');
  });
});
