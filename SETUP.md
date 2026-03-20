# Filmclub — Setup Guide

Get the app live in three steps. Each one takes about 5 minutes.

---

## Step 1 — Supabase (database)

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click **New project**, give it a name (e.g. `filmclub`), choose a region close to you
3. Wait for it to provision (~1 minute)
4. Go to **SQL Editor** (left sidebar) and paste the entire contents of `supabase/schema.sql`, then click **Run**
5. Go to **Project Settings → API**
6. Copy:
   - **Project URL** → this is your `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Step 2 — TMDB (film data)

1. Go to [themoviedb.org](https://www.themoviedb.org) and create a free account
2. Go to **Settings → API** and request an API key (choose Developer, fill in the form)
3. Copy the **API Key (v3 auth)** → this is your `NEXT_PUBLIC_TMDB_API_KEY`

---

## Step 3 — Vercel (hosting)

1. Go to [vercel.com](https://vercel.com) and sign up with your GitHub account
2. Click **Add New → Project**
3. Import the `Filmclub` repository from GitHub
4. Before deploying, click **Environment Variables** and add these three:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | from Step 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Step 1 |
| `NEXT_PUBLIC_TMDB_API_KEY` | from Step 2 |

5. Click **Deploy**
6. In ~60 seconds you'll have a live URL — open it on your phone

---

## Local development (optional)

```bash
# Copy the example env file
cp .env.example .env.local

# Paste your three keys into .env.local, then:
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## How it works

- **Create a session** — choose Live (for tonight on the couch) or Planned (swipe over days)
- **Share the code** — friends tap the share button or go to the URL and enter the code
- **Swipe** — drag right to like, left to pass. Tap the ℹ button for synopsis and cast
- **Match** — in Live mode the app locks when a film is liked by enough people. In Planned mode check the results page anytime and lock it in when you're ready
- **Add films** — tap the + button to search for any film and add it to the pool

---

## Future features planned

- Letterboxd import
- Streaming service filtering (at-home mode)
- Cinema mode with local showtimes
- Food / restaurant matching
