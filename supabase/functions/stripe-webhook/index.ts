// QB Brain Pro — Stripe webhook: the ONLY thing that writes the entitlements table.
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
//   (Stripe can't send a Supabase login; the request is verified with the Stripe signature instead.)
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (from the webhook endpoint you create in Stripe)
// In Stripe → Developers → Webhooks, send: checkout.session.completed, customer.subscription.created,
//   customer.subscription.updated, customer.subscription.deleted

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error("Missing secret " + k);
  return v;
};
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Stripe-Signature: t=timestamp,v1=hmac_sha256(secret, `${t}.${body}`)
async function verify(body: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p[0] !== "v1"));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", key, enc.encode(t + "." + body)));
  return sigs.some((s) => s.length === want.length && [...s].every((c, i) => c === want[i]));
}

async function stripe(path: string) {
  const r = await fetch("https://api.stripe.com/v1/" + path, { headers: { Authorization: "Bearer " + env("STRIPE_SECRET_KEY") } });
  if (!r.ok) throw new Error("Stripe " + path + " " + r.status);
  return r.json();
}

const STATUS: Record<string, string> = { active: "active", trialing: "trialing", past_due: "past_due", canceled: "canceled" };

// one row per account; Pro while the subscription is active, trialing or briefly past due
async function save(sub: any) {
  const userId = sub.metadata && sub.metadata.user_id;
  if (!userId) return;
  const status = STATUS[sub.status] || "inactive";
  const end = sub.current_period_end ?? (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end);
  const row = {
    user_id: userId,
    plan: ["active", "trialing", "past_due"].includes(status) ? "pro" : "free",
    status,
    provider: "stripe",
    provider_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const svc = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(env("SUPABASE_URL") + "/rest/v1/entitlements", {
    method: "POST",
    headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error("entitlements upsert " + r.status + " " + (await r.text()));
}

Deno.serve(async (req) => {
  const body = await req.text();
  if (!(await verify(body, req.headers.get("Stripe-Signature"), env("STRIPE_WEBHOOK_SECRET")))) return new Response("bad signature", { status: 400 });
  const event = JSON.parse(body);
  try {
    const o = event.data.object;
    if (event.type === "checkout.session.completed" && o.mode === "subscription" && o.subscription) {
      const sub = await stripe("subscriptions/" + o.subscription);
      if (!sub.metadata || !sub.metadata.user_id) sub.metadata = { ...(sub.metadata || {}), user_id: o.client_reference_id };
      await save(sub);
    } else if (event.type.startsWith("customer.subscription.")) {
      await save(o);
    }
    return new Response("ok");
  } catch (e) {
    // a non-2xx makes Stripe retry later
    return new Response(String((e as Error).message || e), { status: 500 });
  }
});
