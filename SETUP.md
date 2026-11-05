# Going live

The app is finished code, but nothing is deployed. Do these in order. Allow about 45 minutes.

## 1. Supabase (free plan)

1. Create a project at supabase.com. Pick the Sydney region. Save the database password.
2. In a terminal, run these from the repo:

```bash
supabase login
```

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

```bash
supabase db push
```

3. Go to Authentication, then Sign In / Providers, and turn on **Allow anonymous sign-ins**.
4. Go to Authentication, then Rate Limits, and set anonymous sign-ins to 20 per hour.
5. Copy the project URL, the anon or publishable key, and the service role or secret key.

The free plan has no overage bills. If a limit is reached, the service stops until it resets.

## 2. Upstash (free plan)

Rate limiting. The app will not run in production without it.

1. Create a Redis database at upstash.com, in the Sydney region.
2. Copy the REST URL and REST token.

## 3. Vercel (Pro)

1. Import the GitHub repo. It can stay private, and the site is still public. The framework is detected automatically.
2. Add every setting from `.env.example` for **Production**. Create `CRON_SECRET` with this:

```bash
openssl rand -hex 32
```

3. Use new TMDB and OMDb keys if the old TMDB key was ever public. The old one shipped in browser code, so rotate it.
4. Git auto deploys are off in `vercel.json`. Deploy by hand with `vercel --prod`, then add `filmclub.watch` under Domains if you still own it.

## 4. Spending guardrails, do these before sharing the link

Setting a budget alone does **not** stop spending. Pause must be switched on.

1. Team Settings, then Billing, then **Spend Management**.
2. Turn on Spend Management and set the amount to **$5**. Spend counts only usage beyond your monthly Pro credit, so that means a real-money limit of about $5.
3. Turn on **Pause Production Deployments**. This is the switch that stops the bill.
4. Turn on email or SMS alerts at 50%, 75% and 100%.
5. Under Observability and any other add-ons, leave paid extras off. Keep the seat count at 1.

What to expect:

- Spend is checked every few minutes, so a sudden attack can run slightly past $5.
- While paused, visitors see a 503 error. Resume it from the project page after checking what happened.
- Your subscription fee is separate and is still charged.

Guardrails already in the code:

| Risk | Protection |
|---|---|
| Spam sessions | 10 per hour per person and per IP, plus 300 per hour across the whole app |
| Spam joins or guessing codes | 40 tries per 10 minutes per IP |
| Hammering actions | 150 per minute per person |
| Draining film API quotas | Results cached for hours or days, 60 detail lookups per minute per IP |
| Spamming swipes | Swipes go to the database, capped at one per film per person |
| Image bills | Posters load directly from TMDB, so Vercel image optimisation is never used |
| Reading or changing other sessions | Database rules, tested in `tests/security.test.ts` |
| Limiter outage | Actions are refused rather than running unprotected |

## 5. Check it works

1. Open the site on your phone and start a session.
2. Press Test it, then play a full round with bots.
3. Join the same session from a second phone.
4. Vercel, Cron Jobs: run `/api/cron/cleanup` once and confirm it returns 200.

The daily cleanup also touches the database, which should stop a free project pausing after a week without activity. Supabase says this is usually enough but not guaranteed, so check on it now and then.

## Local development

Needs Docker, the Supabase CLI and Node 22 or newer.

```bash
supabase start
```

```bash
supabase status -o env
```

Put the values in `.env.development.local`, using the names from `.env.example`, then:

```bash
npm run dev
```

```bash
npm test
```

The database and full-round tests run only when local Supabase and a dev server on port 3100 are up. Otherwise they skip.
