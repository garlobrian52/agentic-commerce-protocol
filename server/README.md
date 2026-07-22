# Stripe reference servers

This directory contains reference server implementations that complement the [Agentic Commerce Protocol (ACP)](../README.md).

## Accounts v2 — embedded payments and subscriptions

See **[node/](node/)** for a Node.js server that implements Stripe Accounts v2:

- Create and onboard connected accounts (`/v2/core/accounts`, `/v2/core/account_links`)
- Accept payments on connected accounts via Checkout with an application fee
- Charge connected accounts a platform subscription from their Stripe balance

```bash
cd server/node
cp .env.example .env   # set STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY from the Dashboard
npm install
npm start
```

Full endpoint walkthrough: [node/README.md](node/README.md).
