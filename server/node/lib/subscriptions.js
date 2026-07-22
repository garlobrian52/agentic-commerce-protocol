'use strict';

/**
 * Create the platform subscription product + default monthly price.
 *
 * Blueprint: POST /v1/products
 */
async function createSubscriptionProduct(stripe, {
  name = 'Platform subscription',
  currency = process.env.CURRENCY || 'usd',
  unitAmount = 1000,
  interval = 'month',
} = {}) {
  return stripe.products.create({
    name,
    default_price_data: {
      currency,
      unit_amount: unitAmount,
      recurring: { interval },
    },
    expand: ['default_price'],
  });
}

/**
 * Attach the connected account's Stripe balance as its default payment method
 * for off-session subscription charges.
 *
 * Blueprint: POST /v1/setup_intents
 */
async function createBalanceSetupIntent(stripe, { accountId }) {
  if (!accountId) {
    throw new Error('accountId is required to create a setup intent');
  }

  return stripe.setupIntents.create({
    payment_method_types: ['stripe_balance'],
    confirm: true,
    customer_account: accountId,
    usage: 'off_session',
    payment_method_data: {
      type: 'stripe_balance',
    },
  });
}

/**
 * Charge a connected account a platform subscription fee from its Stripe balance.
 *
 * Blueprint: POST /v1/subscriptions
 */
async function createAccountSubscription(stripe, {
  accountId,
  priceId,
  paymentMethodId,
  quantity = 1,
}) {
  if (!accountId) {
    throw new Error('accountId is required to create a subscription');
  }
  if (!priceId) {
    throw new Error('priceId is required to create a subscription');
  }
  if (!paymentMethodId) {
    throw new Error('paymentMethodId is required to create a subscription');
  }

  return stripe.subscriptions.create({
    customer_account: accountId,
    default_payment_method: paymentMethodId,
    items: [{ price: priceId, quantity }],
    payment_settings: {
      payment_method_types: ['stripe_balance'],
    },
  });
}

/**
 * Full platform billing setup for a connected account:
 * product → balance SetupIntent → subscription.
 */
async function chargeAccountSubscription(stripe, {
  accountId,
  productName,
  currency,
  unitAmount,
  existingPriceId,
} = {}) {
  let priceId = existingPriceId;
  let product = null;

  if (!priceId) {
    product = await createSubscriptionProduct(stripe, {
      name: productName,
      currency,
      unitAmount,
    });
    priceId =
      typeof product.default_price === 'string'
        ? product.default_price
        : product.default_price.id;
  }

  const setupIntent = await createBalanceSetupIntent(stripe, { accountId });
  const subscription = await createAccountSubscription(stripe, {
    accountId,
    priceId,
    paymentMethodId: setupIntent.payment_method,
  });

  return { product, priceId, setupIntent, subscription };
}

module.exports = {
  createSubscriptionProduct,
  createBalanceSetupIntent,
  createAccountSubscription,
  chargeAccountSubscription,
};
