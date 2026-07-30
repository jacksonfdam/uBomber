# Deployment

Production topology: **Vercel** serves the static site (landing page +
exported game), **Supabase** provides the realtime backend. Both have free
tiers that comfortably run this game.

## Building the web export

1. Install a [GodotJS](https://godotjs.github.io/) editor build (Godot 4.x
   with the GodotJS module) and its **web export templates** (Editor →
   Manage Export Templates, or download from the GodotJS releases page).
2. Compile the scripts first:

   ```bash
   cd game
   npm install
   npm run build        # TypeScript → .godot/GodotJS/ (engine-side mirror)
   npm run bundle:net   # network layer + supabase-js → web/public/game/net-bundle.js
   ```

3. Export with the bundled **Web** preset (writes to `web/public/game/`):

   ```bash
   # GUI: Project > Export… > Web > Export Project
   # or headless:
   godot --headless --path game --export-release "Web" ../web/public/game/index.html
   ```

## Supabase (backend)

### Via the Vercel Marketplace (recommended)

```bash
vercel link                            # link the repo to a Vercel project
vercel integration add supabase       # provision Supabase, wire env vars
```

### Or a standalone Supabase project

Create a project at [database.new](https://database.new), then apply the
schema:

```bash
supabase link --project-ref <YOUR-PROJECT-REF>
supabase db push                       # applies supabase/migrations/
```

Schedule room garbage collection (SQL editor or a migration):

```sql
select cron.schedule('cleanup-stale-rooms', '0 * * * *',
                     'select public.cleanup_stale_rooms()');
```

(Enable the `pg_cron` extension in Dashboard → Database → Extensions first.)

## Runtime configuration

The deployed game reads `/config.json` at runtime — no rebuild needed to
change backends:

```bash
cp web/public/config.json.example web/public/config.json
# fill in supabaseUrl + supabaseAnonKey (Dashboard → Settings → API)
```

The anon key is public by design; the schema's row-level-security policies
are what protect the data (rooms are anonymous, throwaway rows).

> `web/public/config.json` is gitignored. For CI-driven deploys, generate it
> during the deploy step from environment variables instead of committing it.

## Vercel (hosting)

`vercel.json` already configures everything static hosting needs, including
the `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers that
Godot web exports require:

```bash
vercel          # preview deployment
vercel --prod   # production
```

The project is a plain static deploy of `web/public` — there is no build
step on Vercel's side, so deploys are instant. A typical release is:

```bash
cd game && npm run build && npm run bundle:net
godot --headless --path game --export-release "Web" ../web/public/game/index.html
cd .. && vercel --prod
```

## Checklist

- [ ] Web export present in `web/public/game/`
- [ ] `web/public/config.json` filled with the production Supabase URL + anon key
- [ ] Migrations applied (`supabase db push`)
- [ ] `cleanup-stale-rooms` scheduled with pg_cron
- [ ] `vercel --prod` from the repo root
