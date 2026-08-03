# Deployment

Production topology: **Vercel** builds and serves the static site, **Supabase**
provides the realtime backend. Both have free tiers that comfortably run this
game.

There is no export step and no art pipeline — `vercel.json` points Vercel at
`npm run build`, which typechecks and emits `dist/`.

## Vercel (hosting)

```bash
vercel          # preview deployment
vercel --prod   # production
```

`vercel.json` sets the framework to Vite, the output to `dist/`, immutable
caching on hashed assets, and `no-store` on `/config.json` so a backend change
takes effect on the next page load.

## Supabase (backend)

### Via the Vercel Marketplace (recommended)

```bash
vercel link                        # link the repo to a Vercel project
vercel integration add supabase    # provision Supabase, wire env vars
```

### Or a standalone Supabase project

Create a project at [database.new](https://database.new), then apply the schema:

```bash
supabase link --project-ref <YOUR-PROJECT-REF>
supabase db push                   # applies supabase/migrations/
```

Schedule room garbage collection (SQL editor or a migration):

```sql
select cron.schedule('cleanup-stale-rooms', '0 * * * *',
                     'select public.cleanup_stale_rooms()');
```

(Enable the `pg_cron` extension in Dashboard → Database → Extensions first.)

## Runtime configuration

The deployed game reads `/config.json` at runtime — no rebuild needed to change
backends:

```bash
cp public/config.json.example public/config.json
# fill in supabaseUrl + supabaseAnonKey (Dashboard → Settings → API)
```

The anon key is public by design; the schema's row-level-security policies are
what protect the data (rooms are anonymous, throwaway rows).

> `public/config.json` is gitignored. For CI-driven deploys, generate it during
> the build step from environment variables instead of committing it.

Without a `config.json` the game still works: solo play and the campaign are
unaffected, and the online buttons report that no backend is configured.

## Checklist

- [ ] `npm run build` passes locally (CI runs it too)
- [ ] `public/config.json` generated with the production Supabase URL + anon key
- [ ] Migrations applied (`supabase db push`)
- [ ] `cleanup-stale-rooms` scheduled with pg_cron
- [ ] `vercel --prod`
