'use strict';

/**
 * Create a connected Account (Accounts v2) configured as merchant + customer.
 * The merchant configuration lets the seller accept payments; the customer
 * configuration lets the platform charge the account subscription fees.
 *
 * Blueprint: POST /v2/core/accounts
 */
async function createAccount(stripe, {
  displayName = 'Test account',
  contactEmail = 'testaccount@example.com',
  country = process.env.CONNECTED_ACCOUNT_COUNTRY || 'US',
  phone = '0000000000',
} = {}) {
  return stripe.v2.core.accounts.create({
    display_name: displayName,
    contact_email: contactEmail,
    dashboard: 'full',
    identity: {
      country,
      business_details: {
        phone,
      },
    },
    defaults: {
      responsibilities: {
        losses_collector: 'stripe',
        fees_collector: 'stripe',
      },
    },
    configuration: {
      // Workbench blueprints pass simulate_accept_tos_obo in test mode.
      merchant: {
        simulate_accept_tos_obo: true,
        capabilities: {
          card_payments: { requested: true },
        },
      },
      customer: {},
    },
    include: [
      'configuration.merchant',
      'configuration.recipient',
      'identity',
      'defaults',
      'configuration.customer',
    ],
  });
}

/**
 * Create an Account Link for Stripe-hosted KYC onboarding.
 *
 * Blueprint: POST /v2/core/account_links
 */
async function createAccountLink(stripe, {
  accountId,
  returnUrl,
  refreshUrl,
}) {
  if (!accountId) {
    throw new Error('accountId is required to create an account link');
  }

  const domain = process.env.DOMAIN || 'http://localhost:4242';

  return stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant', 'customer'],
        return_url: returnUrl || `${domain}/onboarding/return`,
        refresh_url: refreshUrl || `${domain}/onboarding/refresh`,
      },
    },
  });
}

module.exports = { createAccount, createAccountLink };
