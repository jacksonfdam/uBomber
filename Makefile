# Developer entry points. See docs/LOCAL_DEVELOPMENT.md for details.

.PHONY: install test typecheck build db-start db-stop db-reset web-up web-down

## Install game dependencies
install:
	cd game && npm install

## Run the unit test suite (core simulation, maps, bots, protocol)
test:
	cd game && npm test

## Typecheck all TypeScript
typecheck:
	cd game && npm run typecheck

## Compile GodotJS scripts and bundle the network layer
build:
	cd game && npm run build && npm run bundle:net

## Start the local Supabase stack (Docker, via Supabase CLI)
db-start:
	supabase start

## Stop the local Supabase stack
db-stop:
	supabase stop

## Reset the local database and re-apply migrations
db-reset:
	supabase db reset

## Serve the landing page + exported game at http://localhost:8080
web-up:
	docker compose up -d web

web-down:
	docker compose down
