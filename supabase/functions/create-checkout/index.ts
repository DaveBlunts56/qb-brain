// QB Brain Pro — create a Stripe Checkout page for the signed-in account.
// Deploy:  supabase functions deploy create-checkout
// Secrets (supabase secrets set ...): STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY, APP_URL
//   APP_URL = where the app lives, e.g. https://daveblunts56.github.io/qb-brain/ (return links must start with it)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// The secret keys stay on the server. The app only ever receives the checkout URL.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error("Missing secret " + k);
  return v;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    // 1) who is asking: the signed-in parent account (from their access token)
    const auth = req.headers.get("Authorization") || "";
    const ures = await fetch(env("SUPABASE_URL") + "/auth/v1/user", { headers: { Authorization: auth, apikey: env("SUPABASE_ANON_KEY") } });
    if (!ures.ok) return json({ error: "Please sign in again." }, 401);
    const user = await ures.json();

    // 2) which plan, and where to come back to (only our own app)
    const { plan, success_url, cancel_url } = await req.json();
    const price = plan === "yearly" ? env("STRIPE_PRICE_YEARLY") : plan === "monthly" ? env("STRIPE_PRICE_MONTHLY") : null;
    if (!price) return json({ error: "Unknown plan." }, 400);
    const app = env("APP_URL");
    const ok = (u: unknown) => typeof u === "string" && u.startsWith(app);
    if (!ok(success_url) || !ok(cancel_url)) return json({ error: "Bad return address." }, 400);

    // 3) reuse the Stripe customer if this account bought before
    const svc = env("SUPABASE_SERVICE_ROLE_KEY");
    const eres = await fetch(env("SUPABASE_URL") + "/rest/v1/entitlements?select=provider_customer_id&user_id=eq." + user.id, {
      headers: { apikey: svc, Authorization: "Bearer " + svc },
    });
    const existing = eres.ok ? (await eres.json())[0] : null;

    // 4) the Checkout Session (Stripe REST API, form-encoded)
    const f = new URLSearchParams();
    f.set("mode", "subscription");
    f.set("line_items[0][price]", price);
    f.set("line_items[0][quantity]", "1");
    f.set("success_url", success_url);
    f.set("cancel_url", cancel_url);
    f.set("client_reference_id", user.id);
    f.set("metadata[user_id]", user.id);
    f.set("subscription_data[metadata][user_id]", user.id);
    f.set("allow_promotion_codes", "true");
    if (existing && existing.provider_customer_id) f.set("customer", existing.provider_customer_id);
    else if (user.email) f.set("customer_email", user.email);
    const sres = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + env("STRIPE_SECRET_KEY"), "Content-Type": "application/x-www-form-urlencoded" },
      body: f,
    });
    const session = await sres.json();
    if (!sres.ok) return json({ error: (session.error && session.error.message) || "Checkout failed." }, 502);
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
