# Developer entry points. See docs/LOCAL_DEVELOPMENT.md for details.

.PHONY: install dev build preview test typecheck check db-start db-stop db-reset

## Install dependencies
install:
	npm install

## Run the dev server (prints a local URL)
dev:
	npm run dev

## Typecheck and produce the production build in dist/
build:
	npm run build

## Serve the production build locally
preview:
	npm run preview

## Run the test suite (sim, maps, bots, protocol, determinism, fuzz, perf)
test:
	npm test

## Typecheck without emitting
typecheck:
	npm run typecheck

## Everything CI runs
check: typecheck test build

## Start the local Supabase stack (Docker, via the Supabase CLI)
db-start:
	supabase start

## Stop the local Supabase stack
db-stop:
	supabase stop

## Reset the local database and re-apply migrations
db-reset:
	supabase db reset
