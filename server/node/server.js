'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const { createStripeClient } = require('./lib/stripe');
const { SellerStore } = require('./lib/store');
const { createAccount, createAccountLink } = require('./lib/accounts');
const { createCheckoutSession } = require('./lib/payments');
const {
  createSubscriptionProduct,
  createBalanceSetupIntent,
  createAccountSubscription,
  chargeAccountSubscription,
} = require('./lib/subscriptions');
const { createWebhookHandler } = require('./lib/webhooks');

const app = express();
const store = new SellerStore(path.join(__dirname, 'data', 'sellers.json'));
const handleWebhookEvent = createWebhookHandler({ store });

let stripe;
try {
  stripe = createStripeClient();
} catch (err) {
  console.warn(err.message);
}

function requireStripe(req, res, next) {
  if (!stripe) {
    return res.status(500).json({
      error:
        'Stripe is not configured. Set STRIPE_SECRET_KEY from https://dashboard.stripe.com/apikeys',
    });
  }
  return next();
}

function resolveSellerId(body = {}) {
  return body.sellerId || body.seller_id || `seller_${Date.now()}`;
}

app.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    currency: process.env.CURRENCY || 'usd',
    connectedAccountCountry: process.env.CONNECTED_ACCOUNT_COUNTRY || 'US',
  });
});

/**
 * Create and persist a connected account for a seller.
 * POST /create-account
 */
app.post('/create-account', express.json(), requireStripe, async (req, res) => {
  try {
    const sellerId = resolveSellerId(req.body);
    const existing = store.getSeller(sellerId);
    if (existing?.accountId) {
      return res.json({ seller: existing, reused: true });
    }

    const account = await createAccount(stripe, {
      displayName: req.body.displayName || req.body.display_name || 'Test account',
      contactEmail: req.body.contactEmail || req.body.contact_email || 'testaccount@example.com',
      country: req.body.country || process.env.CONNECTED_ACCOUNT_COUNTRY || 'US',
      phone: req.body.phone || '0000000000',
    });

    const seller = store.upsertSeller(sellerId, {
      accountId: account.id,
      displayName: account.display_name,
      contactEmail: account.contact_email,
      onboardingStatus: 'pending',
    });

    res.json({ account, seller });
  } catch (err) {
    console.error('create-account failed', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * Create a Stripe-hosted onboarding Account Link for KYC.
 * POST /create-account-link
 */
app.post('/create-account-link', express.json(), requireStripe, async (req, res) => {
  try {
    const sellerId = req.body.sellerId || req.body.seller_id;
    const seller = sellerId ? store.getSeller(sellerId) : null;
    const accountId = req.body.accountId || req.body.account_id || seller?.accountId;

    const accountLink = await createAccountLink(stripe, {
      accountId,
      returnUrl: req.body.returnUrl || req.body.return_url,
      refreshUrl: req.body.refreshUrl || req.body.refresh_url,
    });

    if (sellerId) {
      store.upsertSeller(sellerId, {
        accountId,
        onboardingStatus: 'link_created',
        lastAccountLinkUrl: accountLink.url,
      });
    }

    res.json({ accountLink });
  } catch (err) {
    console.error('create-account-link failed', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * Create a Checkout Session on the connected account (direct charge + app fee).
 * POST /create-checkout-session
 */
app.post('/create-checkout-session', express.json(), requireStripe, async (req, res) => {
  try {
    const sellerId = req.body.sellerId || req.body.seller_id;
    const seller = sellerId ? store.getSeller(sellerId) : null;
    const accountId = req.body.accountId || req.body.account_id || seller?.accountId;

    const session = await createCheckoutSession(stripe, {
      accountId,
      currency: req.body.currency || process.env.CURRENCY || 'usd',
      productName: req.body.productName || 'Cookie',
      unitAmount: req.body.unitAmount ?? 100000,
      applicationFeeAmount: req.body.applicationFeeAmount ?? 123,
      successUrl: req.body.successUrl,
      cancelUrl: req.body.cancelUrl,
    });

    if (sellerId) {
      store.upsertSeller(sellerId, {
        lastCheckoutSessionId: session.id,
        lastCheckoutSessionUrl: session.url,
      });
    }

    res.json({ session, url: session.url });
  } catch (err) {
    console.error('create-checkout-session failed', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * Create the platform subscription product/price (once).
 * POST /create-product
 */
app.post('/create-product', express.json(), requireStripe, async (req, res) => {
  try {
    const product = await createSubscriptionProduct(stripe, {
      name: req.body.name || 'Platform subscription',
      currency: req.body.currency || process.env.CURRENCY || 'usd',
      unitAmount: req.body.unitAmount ?? 1000,
      interval: req.body.interval || 'month',
    });

    const priceId =
      typeof product.default_price === 'string'
        ? product.default_price
        : product.default_price?.id;

    res.json({ product, priceId });
  } catch (err) {
    console.error('create-product failed', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * Attach stripe_balance as the connected account's payment method.
 * POST /create-setup-intent
 */
app.post('/create-setup-intent', express.json(), requireStripe, async (req, res) => {
  try {
    const sellerId = req.body.sellerId || req.body.seller_id;
    const seller = sellerId ? store.getSeller(sellerId) : null;
    const accountId = req.body.accountId || req.body.account_id || seller?.accountId;

    const setupIntent = await createBalanceSetupIntent(stripe, { accountId });

    if (sellerId) {
      store.upsertSeller(sellerId, {
        defaultPaymentMethodId: setupIntent.payment_method,
      });
    }

    res.json({ setupIntent, paymentMethodId: setupIntent.payment_method });
  } catch (err) {
    console.error('create-setup-intent failed', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * Create a subscription that charges the connected account's Stripe balance.
 * POST /create-subscription
 *
 * Prefers previously created product/price and payment method IDs from the
 * seller record when not supplied in the request body.
 */
app.post('/create-subscription', express.json(), requireStripe, async (req, res) => {
  try {
    const sellerId = req.body.sellerId || req.body.seller_id;
    const seller = sellerId ? store.getSeller(sellerId) : null;
    const accountId = req.body.accountId || req.body.account_id || seller?.accountId;

    let priceId = req.body.priceId || req.body.price_id || seller?.priceId;
    let paymentMethodId =
      req.body.paymentMethodId ||
      req.body.payment_method_id ||
      req.body.defaultPaymentMethod ||
      seller?.defaultPaymentMethodId;

    let product = null;
    let setupIntent = null;

    if (!priceId || !paymentMethodId) {
      const result = await chargeAccountSubscription(stripe, {
        accountId,
        productName: req.body.productName || 'Platform subscription',
        currency: req.body.currency || process.env.CURRENCY || 'usd',
        unitAmount: req.body.unitAmount ?? 1000,
        existingPriceId: priceId,
      });
      product = result.product;
      priceId = result.priceId;
      setupIntent = result.setupIntent;
      paymentMethodId = result.setupIntent.payment_method;

      if (sellerId) {
        store.upsertSeller(sellerId, {
          accountId,
          productId: product?.id || seller?.productId,
          priceId,
          defaultPaymentMethodId: paymentMethodId,
          subscriptionId: result.subscription.id,
          subscriptionStatus: result.subscription.status,
        });
      }

      return res.json({
        product,
        priceId,
        setupIntent,
        subscription: result.subscription,
      });
    }

    const subscription = await createAccountSubscription(stripe, {
      accountId,
      priceId,
      paymentMethodId,
      quantity: req.body.quantity ?? 1,
    });

    if (sellerId) {
      store.upsertSeller(sellerId, {
        accountId,
        priceId,
        defaultPaymentMethodId: paymentMethodId,
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
      });
    }

    res.json({ subscription, priceId, paymentMethodId });
  } catch (err) {
    console.error('create-subscription failed', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * Convenience endpoint: onboard seller → optional checkout → charge subscription.
 * POST /onboard-and-subscribe
 */
app.post('/onboard-and-subscribe', express.json(), requireStripe, async (req, res) => {
  try {
    const sellerId = resolveSellerId(req.body);
    let seller = store.getSeller(sellerId);
    let account = null;
    let accountLink = null;

    if (!seller?.accountId) {
      account = await createAccount(stripe, {
        displayName: req.body.displayName || 'Test account',
        contactEmail: req.body.contactEmail || 'testaccount@example.com',
        country: req.body.country || process.env.CONNECTED_ACCOUNT_COUNTRY || 'US',
      });
      seller = store.upsertSeller(sellerId, {
        accountId: account.id,
        displayName: account.display_name,
        contactEmail: account.contact_email,
        onboardingStatus: 'pending',
      });
    }

    accountLink = await createAccountLink(stripe, { accountId: seller.accountId });
    store.upsertSeller(sellerId, {
      onboardingStatus: 'link_created',
      lastAccountLinkUrl: accountLink.url,
    });

    res.json({
      seller: store.getSeller(sellerId),
      account,
      accountLink,
      next: {
        completeOnboarding: accountLink.url,
        thenCreateCheckoutSession: 'POST /create-checkout-session',
        thenCreateSubscription: 'POST /create-subscription',
      },
    });
  } catch (err) {
    console.error('onboard-and-subscribe failed', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/sellers/:sellerId', (req, res) => {
  const seller = store.getSeller(req.params.sellerId);
  if (!seller) {
    return res.status(404).json({ error: 'Seller not found' });
  }
  return res.json({ seller });
});

app.get('/sellers', (req, res) => {
  res.json({ sellers: store.listSellers() });
});

app.get('/onboarding/return', (req, res) => {
  res.json({
    message: 'Onboarding return URL reached. Continue with checkout or subscription setup.',
  });
});

app.get('/onboarding/refresh', async (req, res) => {
  res.json({
    message: 'Onboarding refresh URL reached. Create a new account link via POST /create-account-link.',
  });
});

app.get('/checkout/success', (req, res) => {
  res.json({
    message: 'Checkout completed',
    sessionId: req.query.session_id || null,
  });
});

app.get('/checkout/cancel', (req, res) => {
  res.json({ message: 'Checkout canceled' });
});

/**
 * Stripe webhooks — keep raw body for signature verification.
 */
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured' });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event = req.body;

    try {
      if (webhookSecret) {
        const signature = req.headers['stripe-signature'];
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      } else if (Buffer.isBuffer(req.body)) {
        event = JSON.parse(req.body.toString('utf8'));
      }
    } catch (err) {
      console.error('Webhook signature verification failed', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      const result = await handleWebhookEvent(event);
      res.json(result);
    } catch (err) {
      console.error('Webhook handler failed', err);
      res.status(500).json({ error: err.message });
    }
  }
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const port = process.env.PORT || 4242;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Accounts v2 server listening on http://localhost:${port}`);
  });
}

module.exports = { app, store };
