-- Feedback / message submissions from the homepage panel
create table if not exists feedback (
  id            uuid primary key default gen_random_uuid(),
  tag           text not null check (tag in ('feature', 'bug', 'other')),
  message       text not null,
  sender_email  text,
  created_at    timestamptz not null default now()
);

-- No RLS — inserts come from the server-side API route using the service role key
