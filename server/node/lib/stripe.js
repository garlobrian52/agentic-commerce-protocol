'use strict';

const Stripe = require('stripe');

/**
 * Initialize the Stripe client.
 * Leave the API version unset so the SDK default is used unless a blueprint
 * explicitly requires a pinned version.
 */
function createStripeClient(secretKey = process.env.STRIPE_SECRET_KEY) {
  if (!secretKey) {
    throw new Error(
      'Missing STRIPE_SECRET_KEY. Copy .env.example to .env and set keys from https://dashboard.stripe.com/apikeys'
    );
  }

  return new Stripe(secretKey);
}

module.exports = { createStripeClient };
