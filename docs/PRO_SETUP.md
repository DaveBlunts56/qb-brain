# Turning on QB Brain Pro payments

QB Brain Pro is built so that **only your server can grant Pro**. The app reads the signed-in account's row in the `entitlements` table, and nothing the app sends can change that row. Payments go through **Stripe Checkout**, so card details never touch QB Brain.

Until this is set up, the Upgrade screen shows the plans and says checkout isn't connected. Nothing is charged, and nothing is unlocked. Beta builds (`"channel": "beta"` in `package.json`) unlock Pro for testers and have a **Preview as Free** switch in Settings.

You need accounts working first: see [CLOUD_SETUP.md](CLOUD_SETUP.md).

## 1. Stripe
1. Create a Stripe account. Stay in **Test mode** until everything works.
2. **Product catalog → Add product**: "QB Brain Pro", with two recurring prices, monthly and yearly. Copy both **price IDs** (`price_...`).
3. Match the prices shown in the app: edit `PLANS` at the top of `src/js/pro.js`.

## 2. Server functions (Supabase Edge Functions)
Install the Supabase CLI, run `supabase login`, then `supabase link` to your project. From the repo root:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_PRICE_MONTHLY=price_... STRIPE_PRICE_YEARLY=price_... \
  APP_URL=https://daveblunts56.github.io/qb-brain/
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```

- `create-checkout` checks who is signed in, then asks Stripe for a checkout page for that account. It only accepts return links that start with `APP_URL`.
- `stripe-webhook` is the only code that writes `entitlements`. It verifies Stripe's signature on every call.

## 3. Webhook
1. In Stripe, go to **Developers → Webhooks → Add endpoint**.
2. URL: `https://YOUR-PROJECT.supabase.co/functions/v1/stripe-webhook`
3. Events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the **signing secret** (`whsec_...`) and set it:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

## 4. Switch the app over
1. In `cloud.config.json`, set `"checkout": true`.
2. In `package.json`, set `"channel"` to `"stable"`. Beta builds give everyone Pro.
3. In `package.json`, set `"features": { "accounts": true }`.
4. Run `npm run build`, then commit and push.

## 5. Test it (Stripe test mode)
1. Sign in as a parent, open **Go Pro**, and pick a plan.
2. After the grown-ups question, you land on Stripe. Pay with the test card `4242 4242 4242 4242`.
3. You come back to the Upgrade screen. "Confirming your payment…" turns into "Pro is active" within a few seconds.
4. In Stripe, cancel the subscription. When the paid period ends, the webhook marks the account Free again.

## Security notes
- These keys live **only** in Supabase secrets, never in the app or the repo:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `SUPABASE_SERVICE_ROLE_KEY`
- The app shows Pro from its last check while offline. When the paid period ends, it gives a 3-day grace period, then locks.
- Cancelling, refunds and receipts are handled by Stripe. To let parents manage billing themselves, you can turn on Stripe's **customer portal**.
