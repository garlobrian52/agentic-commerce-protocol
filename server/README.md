# Usage-Based Subscriptions Server

This directory contains reference server implementations for usage-based subscriptions with Stripe Billing, intended as a companion to the [Agentic Commerce Protocol (ACP)](../README.md).

These servers demonstrate how a merchant backend can expose ACP-compatible checkout endpoints while billing customers based on metered usage — for example, charging per API call, per AI agent session, or per unit consumed.

---

## Environment Setup

### Prerequisites

- A [Stripe account](https://dashboard.stripe.com/register)
- Stripe API keys (from the [Stripe Dashboard](https://dashboard.stripe.com/apikeys))
- Node.js v14+ (or the runtime for your chosen server language)

### Configuration

Copy the example environment file and fill in your Stripe credentials:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Price IDs for your metered usage plans (from Stripe Dashboard)
BASIC=price_...
PREMIUM=price_...

# Stripe Meters API (for the new meters approach)
STRIPE_METER_ID=mtr_...

STATIC_DIR=../../client
```

> **Note:** Never commit your `.env` file. It is listed in `.gitignore` by default.

---

## Running the Server

```bash
cd server/node
npm install
npm start
```

The server starts on `http://localhost:4242`.

---

## Endpoint Walkthroughs

The server exposes the following REST endpoints:

### `GET /config`
Returns public configuration (publishable key) for the frontend client.

**Response:**
```json
{
  "publishableKey": "pk_test_..."
}
```

---

### `POST /create-customer`
Creates a new Stripe Customer for the buyer.

**Request:**
```json
{
  "email": "buyer@example.com"
}
```

**Response:** Returns the full Stripe [Customer object](https://stripe.com/docs/api/customers/object).

---

### `POST /create-subscription`
Attaches a payment method to a customer and creates a metered subscription.

**Request:**
```json
{
  "customerId": "cus_...",
  "paymentMethodId": "pm_...",
  "priceId": "BASIC"
}
```

**Response:** Returns the full Stripe [Subscription object](https://stripe.com/docs/api/subscriptions/object), expanded with `latest_invoice.payment_intent`.

---

### `POST /cancel-subscription`
Cancels an active subscription immediately.

**Request:**
```json
{
  "subscriptionId": "sub_..."
}
```

**Response:** Returns the cancelled Stripe Subscription object.

---

### `POST /update-subscription`
Upgrades or downgrades the customer's plan.

**Request:**
```json
{
  "subscriptionId": "sub_...",
  "newPriceId": "PREMIUM"
}
```

**Response:** Returns the updated Stripe Subscription object.

---

### `POST /retrieve-upcoming-invoice`
Previews the upcoming invoice when switching plans (useful for displaying proration).

**Request:**
```json
{
  "customerId": "cus_...",
  "subscriptionId": "sub_...",
  "newPriceId": "PREMIUM"
}
```

**Response:** Returns the upcoming Stripe [Invoice object](https://stripe.com/docs/api/invoices/upcoming).

---

### `POST /retrieve-customer-payment-method`
Fetches the saved payment method details for a customer.

**Request:**
```json
{
  "paymentMethodId": "pm_..."
}
```

**Response:** Returns the Stripe [PaymentMethod object](https://stripe.com/docs/api/payment_methods/object).

---

### `POST /webhook`
Handles asynchronous Stripe webhook events. See [Webhook Setup](#webhook-setup) below.

---

## Recording Usage

### Legacy Approach (Subscription Items Usage Records)

With the legacy metered billing approach, usage is reported by creating [Usage Records](https://stripe.com/docs/api/usage_records) on a subscription item:

```bash
curl https://api.stripe.com/v1/subscription_items/si_.../usage_records \
  -u sk_test_...: \
  -d quantity=100 \
  -d timestamp=1609459200 \
  -d action=increment
```

- `quantity`: Number of units consumed in this period
- `timestamp`: Unix timestamp for when the usage occurred
- `action`: `increment` (adds to current period total) or `set` (sets the total)

Usage records are aggregated at the end of the billing period and included in the generated invoice.

---

### Meters API (Recommended)

The [Stripe Meters API](https://stripe.com/docs/billing/subscriptions/usage-based/meters) is the modern approach to usage-based billing. It provides better reliability, deduplication, and real-time aggregation.

**1. Create a Meter (once, in the Stripe Dashboard or via API):**

```bash
curl https://api.stripe.com/v1/billing/meters \
  -u sk_test_...: \
  -d display_name="API Calls" \
  -d event_name="api_call" \
  -d default_aggregation[formula]=sum \
  -d customer_mapping[event_payload_key]=stripe_customer_id \
  -d customer_mapping[type]=by_id
```

**2. Report usage events:**

```bash
curl https://api.stripe.com/v1/billing/meter_events \
  -u sk_test_...: \
  -d event_name="api_call" \
  -d payload[value]=1 \
  -d payload[stripe_customer_id]=cus_...
```

- `event_name`: Matches the meter's `event_name`
- `payload[value]`: Number of units for this event
- `payload[stripe_customer_id]`: The Stripe Customer ID for the buyer

**3. Query usage summaries (optional):**

```bash
curl "https://api.stripe.com/v1/billing/meters/mtr_.../event_summaries?customer=cus_...&start_time=1609459200&end_time=1612137600" \
  -u sk_test_...:
```

---

## Legacy vs. Meters API: Key Differences

| Feature | Legacy (Usage Records) | Meters API |
|---|---|---|
| **Idempotency** | Manual (via `idempotency_key` header) | Built-in deduplication |
| **Aggregation** | Sum per billing period | Sum, count, max, last value |
| **Reporting endpoint** | `POST /v1/subscription_items/{id}/usage_records` | `POST /v1/billing/meter_events` |
| **Real-time summaries** | Not available | Available via `/v1/billing/meters/{id}/event_summaries` |
| **Decoupled from subscription** | No — tied to a subscription item | Yes — meters are independent of subscriptions |
| **Recommended for new integrations** | No | ✅ Yes |

> **Migration note:** If you have an existing integration using Usage Records, Stripe recommends migrating to the Meters API for better reliability and features. See the [migration guide](https://stripe.com/docs/billing/subscriptions/usage-based/meters#migration).

---

## Webhook Setup

Stripe sends asynchronous events to your server for billing lifecycle events. Run the Stripe CLI locally to forward events:

```bash
stripe listen --forward-to localhost:4242/webhook
```

The CLI prints a `STRIPE_WEBHOOK_SECRET` — add it to your `.env` file.

### Key webhook events to handle

| Event | Description |
|---|---|
| `invoice.paid` | Subscription payment succeeded; provision/continue service |
| `invoice.payment_failed` | Payment failed; notify the user and request updated payment details |
| `customer.subscription.deleted` | Subscription cancelled; revoke access |
| `customer.subscription.trial_will_end` | Trial ending soon; notify the user |

---

## Testing

Use Stripe's test card numbers:

| Card Number | Scenario |
|---|---|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0025 0000 3155` | 3D Secure authentication required |
| `4000 0000 0000 9995` | Payment declined (insufficient funds) |

Use any future expiry date and any 3-digit CVC.

---

## Supported Languages

- [JavaScript (Node)](node/README.md)
- [Python (Flask)](python/README.md)
- [Ruby (Sinatra)](ruby/README.md)
- [PHP (Slim)](php/README.md)
- [Java (Spark)](java/README.md)
