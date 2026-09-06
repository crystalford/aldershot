# Launch checklist

Everything here is a GitHub repo secret unless stated otherwise. The deploy
workflow reads them and writes them to the Worker on every push, so adding a
secret and re-running the workflow is the whole deployment step.

Nothing in this list needs code. The code is done; these are accounts, keys and
DNS.

---

## 1. The domain  ← do this first, everything else waits on it

Buy it and add it to Cloudflare. Then:

- Workers → aldershot → Settings → Domains & Routes → add `app.<yourdomain>`.
- Repo secret `APP_ORIGIN` = `https://app.<yourdomain>` (no trailing slash).

`APP_ORIGIN` is what login links and Stripe return URLs are built from. Wrong
and every email link points at the old workers.dev host.

## 2. Email — WITHOUT THIS NOBODY CAN SIGN UP

Right now a stranger who enters their address gets *"Sign-in isn't switched on
yet — email delivery isn't configured. Nothing was sent."* That message is
honest, and it means the product has no way in for anyone but you.

- Create a Resend account, add and verify the sending domain (DNS records —
  allow time for propagation).
- Repo secret `RESEND_API_KEY`.
- Change the `from:` address in `src/auth.ts` (`sendLoginEmail`) if it is not
  `hello@aldershot.io`. It must be on the verified domain or Resend rejects it.

Test it by signing in from a browser with no session, using an address that is
not the owner's.

## 3. Payments — and a tax decision to make first

**You are Canadian, and that cuts both ways.**

*Domestically you have room.* Canada's small-supplier threshold is
**CA$30,000** in worldwide taxable revenue over four consecutive quarters
(or in a single quarter). Below that you do not have to register for GST/HST
at all. At USD$29/month that is somewhere around 60–70 paying customers before
it applies. Selling to Canadians only, Stripe is genuinely fine and you have a
real runway.

*Internationally you have none.* For digital services sold to EU consumers
there is **no threshold for a seller established outside the EU** — VAT is due
on the first euro. The €10,000 cross-border threshold is for EU-based sellers
only, so being Canadian is worse here, not better. The UK works the same way.
The compliance route without help is the **Non-Union OSS**: register in one
member state, charge each customer's local rate, file quarterly for the whole
EU.

So the question is not "Stripe or not", it is **who is the merchant of record**:

- **Stripe** — you are. Cheapest per transaction (2.9% + 30¢). You handle
  registration, collection and filing everywhere you sell.
- **Polar / Lemon Squeezy / Paddle** — they are. They become the legal seller
  and remit VAT and sales tax worldwide, including Canadian GST/HST. Costs
  roughly 4–6%, so about **42¢ more per customer per month** on a $29 plan.

The integration shape is the same either way — hosted checkout, then a signed
webhook that sets the plan — so switching later is about an hour, not a
rewrite. **None of this is tax advice; confirm it with an accountant before you
take money.**

### If you stay on Stripe



- Create the account and complete the business details.
- Product "Studio", recurring price **$29/month**. This must match `PLANS` in
  `src/plans.ts` and the landing page — a price customers read and a price
  they are charged that differ is the kind of thing that gets refunded.
- Repo secrets:
  - `STRIPE_SECRET_KEY` — `sk_live_…`
  - `STRIPE_PRICE_ID` — `price_…` (the price, not the product)
  - `STRIPE_WEBHOOK_SECRET` — from the endpoint below
- Webhook endpoint: `https://app.<yourdomain>/webhooks/stripe`, sending
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`.
- Turn on Tax in Stripe if you are registered for VAT/sales tax. Checkout
  already asks for it (`automatic_tax`), but it does nothing until Stripe's own
  tax settings are configured, and it cannot be applied retroactively to
  subscriptions already sold.

Until all three are set, Settings shows no upgrade button at all — deliberately.
An unbuyable plan should not offer to sell.

## 4. Google sign-in (optional, but it is the button people click)

- Google Cloud console → OAuth client (Web).
- Authorised redirect URI: `https://app.<yourdomain>/auth/google/callback`.
- Repo secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Without them the Google button says so rather than failing.

---

## Verifying the whole thing before you tell anyone

1. `BASE=https://app.<yourdomain> node scripts/walk.cjs` — drives every
   surface, flags dead controls and console errors.
2. In a private window, sign up with an address that has never been used. The
   email must arrive.
3. Upload a real video. Watch it read, open it, cut a line, reload — the cut
   must still be there.
4. Subscribe with Stripe's `4242 4242 4242 4242`. Settings must show Studio
   afterwards. **The plan is granted by the webhook, not by the redirect** — if
   Settings still says Free, the webhook is not reaching you; check its
   deliveries in the Stripe dashboard.
5. Cancel from the portal. The plan must drop back to Free.

## What is already true

- `SESSION_SECRET` is set and is never rotated by a deploy (rotating it signs
  everyone out).
- `DEV_LOGIN_EMAIL` — which disables authentication entirely — lives only in
  `.dev.vars`, and the deploy hard-fails if it reappears in `wrangler.jsonc`.
- Caps are enforced before work starts, not after: Free 300 source minutes,
  Studio 1,200. `checkCap` refuses and states the cap.
- The owner account (`chrisrobtelford@gmail.com`) is on Studio by identity and
  is never downgraded by a Stripe event.

## Known and deliberately not fixed for launch

`docs/decisions/clip-ownership.md` — two BRIEFED edits of the same video share
one keep/drop flag, because clips hang off the source rather than the project.
Rare in practice now that opening a video no longer duplicates edits, still
wrong, and a schema change rather than a patch.
