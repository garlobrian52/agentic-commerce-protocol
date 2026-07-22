# Embedded payments and subscriptions (Accounts v2)

Reference Node server that implements Stripe's **Accounts v2** blueprint for:

1. Creating and onboarding connected accounts (merchant + customer configurations)
2. Accepting embedded/direct charges on connected accounts with an application fee
3. Charging connected accounts a platform subscription from their Stripe balance

This sits alongside the [Agentic Commerce Protocol (ACP)](../README.md) as a merchant-platform companion integration.

---

## Environment setup

### Prerequisites

- A [Stripe account](https://dashboard.stripe.com/register) with Connect enabled
- API keys from the [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
- Node.js 18+

### Configuration

```bash
cd server/node
cp .env.example .env
npm install
```

Edit `.env`:

```env
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

CONNECTED_ACCOUNT_COUNTRY=US
CURRENCY=usd
DOMAIN=http://localhost:4242
PORT=4242
```

> Obtain `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` from the Stripe Dashboard. Never commit `.env`.

---

## Run

```bash
cd server/node
npm start
```

Server listens on `http://localhost:4242`.

Forward webhooks locally:

```bash
stripe listen --forward-to localhost:4242/webhook
```

Paste the printed `whsec_...` value into `.env` as `STRIPE_WEBHOOK_SECRET`.

---

## Flow (matches the blueprint)

```text
create-account
    → create-account-link (KYC onboarding)
    → wait for merchant capability update webhook
    → create-checkout-session (direct charge + application fee)
    → wait for checkout.session.completed
    → create-product
    → create-setup-intent (stripe_balance on the account)
    → create-subscription (charge account balance)
    → wait for invoice.payment_succeeded
```

Stripe resource IDs (`accountId`, `priceId`, `defaultPaymentMethodId`, `subscriptionId`, checkout session IDs) are persisted under `server/node/data/sellers.json` and associated with a `sellerId`.

---

## Endpoints

### `GET /config`

Returns publishable configuration for clients.

### `POST /create-account`

Creates a connected Account via `POST /v2/core/accounts` with merchant + customer configurations.

```json
{
  "sellerId": "seller_123",
  "displayName": "Test account",
  "contactEmail": "testaccount@example.com",
  "country": "US"
}
```

### `POST /create-account-link`

Creates a Stripe-hosted onboarding link via `POST /v2/core/account_links` for `merchant` and `customer` configurations.

```json
{
  "sellerId": "seller_123"
}
```

### `POST /create-checkout-session`

Creates a Checkout Session **on the connected account** (`Stripe-Account` header) with `application_fee_amount`.

```json
{
  "sellerId": "seller_123",
  "unitAmount": 100000,
  "applicationFeeAmount": 123
}
```

Open the returned `url` and pay with test card `4000 0000 0000 0077`.

### `POST /create-product`

Creates the platform subscription product (`Platform subscription`, monthly `unit_amount: 1000`).

### `POST /create-setup-intent`

Attaches `stripe_balance` as an off-session payment method for the connected account (`customer_account`).

### `POST /create-subscription`

Creates a subscription that bills the connected account’s Stripe balance. Reuses stored `priceId` / payment method when present; otherwise creates product + setup intent first.

```json
{
  "sellerId": "seller_123"
}
```

### `POST /onboard-and-subscribe`

Convenience starter that creates the account (if needed) and an onboarding link.

### `GET /sellers` / `GET /sellers/:sellerId`

Inspect persisted seller ↔ Stripe ID mappings.

### `POST /webhook`

Handles:

| Event | Purpose |
| --- | --- |
| `v2.core.account[configuration.merchant].capability_status_updated` | Account finished merchant capability onboarding |
| `checkout.session.completed` | Connected-account payment succeeded |
| `invoice.payment_succeeded` | Platform subscription invoice paid |

---

## Tests

```bash
cd server/node
npm test
```

---

## Notes

- The Stripe client is initialized **without** a pinned API version (SDK default).
- Replace `SellerStore` (JSON file) with your production database; keep associating `accountId` / `subscriptionId` with your seller domain model.
- `simulate_accept_tos_obo` is included on merchant configuration to mirror the Workbench blueprint’s test onboarding behavior.
