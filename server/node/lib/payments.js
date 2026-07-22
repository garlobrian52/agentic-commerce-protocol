'use strict';

/**
 * Create a Checkout Session on a connected account so its customer can pay.
 * Charges run on the connected account (Stripe-Account header) with an
 * application fee transferred to the platform.
 *
 * Blueprint: POST /v1/checkout/sessions
 */
async function createCheckoutSession(stripe, {
  accountId,
  currency = process.env.CURRENCY || 'usd',
  productName = 'Cookie',
  unitAmount = 100000,
  applicationFeeAmount = 123,
  successUrl,
  cancelUrl,
}) {
  if (!accountId) {
    throw new Error('accountId is required to create a checkout session');
  }

  const domain = process.env.DOMAIN || 'http://localhost:4242';

  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      success_url:
        successUrl ||
        `${domain}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${domain}/checkout/cancel`,
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: productName,
            },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount,
      },
    },
    {
      stripeAccount: accountId,
    }
  );
}

module.exports = { createCheckoutSession };
