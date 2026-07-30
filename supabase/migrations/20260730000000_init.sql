-- uBomber initial schema.
--
-- The database is intentionally tiny: it only registers invite codes so a
-- guest can validate a room before joining. All gameplay traffic (lobby
-- presence, inputs, snapshots) uses Supabase Realtime broadcast channels
-- and never touches Postgres.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-KM-NP-Z2-9]{6}$'),
  map_id text not null,
  status text not null default 'lobby'
    check (status in ('lobby', 'playing', 'finished')),
  host_client_id text not null,
  created_at timestamptz not null default now()
);

create index rooms_created_at_idx on public.rooms (created_at);

alter table public.rooms enable row level security;

-- Rooms are throwaway, anonymous objects: anyone may create one, look one
-- up by code, or advance its status. Nothing sensitive is stored.
create policy "anyone can create rooms"
  on public.rooms for insert
  to anon, authenticated
  with check (true);

create policy "anyone can read rooms"
  on public.rooms for select
  to anon, authenticated
  using (true);

create policy "anyone can update rooms"
  on public.rooms for update
  to anon, authenticated
  using (true)
  with check (true);

-- Clients may only touch the lifecycle column.
revoke update on public.rooms from anon, authenticated;
grant update (status) on public.rooms to anon, authenticated;

-- Rooms are ephemeral; anything older than a day is garbage.
create or replace function public.cleanup_stale_rooms()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rooms where created_at < now() - interval '24 hours';
$$;

-- On hosted Supabase, schedule the cleanup hourly with pg_cron:
--   select cron.schedule('cleanup-stale-rooms', '0 * * * *',
--                        'select public.cleanup_stale_rooms()');
-- (See docs/DEPLOYMENT.md; pg_cron is enabled from the dashboard.)
