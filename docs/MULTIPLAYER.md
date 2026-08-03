# Multiplayer

## Model

Rooms are **host-authoritative**:

- The room creator (host) runs the one true simulation, including every bot.
- Guests send their `PlayerInput` (~20 Hz); the host feeds those inputs into
  the simulation alongside its own and the bots'.
- The host broadcasts full-state snapshots at 10 Hz; guests render the latest
  snapshot they received.

Full state snapshots are small (one 15×13 grid plus a handful of entities),
which buys enormous simplicity: no prediction, no rollback, no drift. The
trade-off is guest input latency equal to round-trip time — fine for casual
play on nearby connections.

## Transport

Everything rides on one Supabase Realtime channel per room, `room:<CODE>`:

| Concern          | Mechanism                            |
|------------------|--------------------------------------|
| Lobby membership | Channel **presence** (nickname, host flag) |
| Inputs, snapshots, start/game-over | Channel **broadcast** (event `msg`) |
| Invite-code validation | `rooms` table lookup (Postgres) |

The database never sees gameplay traffic. The `rooms` row exists only so a
guest can verify a code and its lifecycle (`lobby` → `playing` → `finished`)
before subscribing, and so stale rooms can be garbage-collected.

## Message flow

```
Host                                   Guests
────                                   ──────
createRoom() ── insert rooms row
             ── subscribe room:CODE
                                        joinRoom(code) ── select rooms row
                                                       ── subscribe room:CODE
   ◄──────────── presence sync ────────────►
start pressed:
  send {type:'start', mapId, seed,
        roster (humans + bots)}  ──────►  build identical GameState
  markStarted()                           find own slot by clientId
loop:                                   loop:
  simulate 30 Hz                          send {type:'input', slot, input}
  send {type:'snapshot', state} 10 Hz ──► render latest snapshot
match ends:
  send {type:'game_over', winner} ─────►  show result
```

Protocol types live in `src/net/protocol.ts` (versioned via
`PROTOCOL_VERSION`).

## Invite links

- Codes are 6 characters from an unambiguous alphabet (no `0/O`, `1/I/L`),
  e.g. `K7WQ2R`.
- Invite URL: `https://<host>/?room=K7WQ2R`. The app parses `?room=` on load, so
  an invited friend clicks the link, types a nickname and presses **Join room**.
- A room holds up to **5 humans** (host + 4 friends). When the host starts
  the match, bots fill remaining slots (at least one bot, up to 6
  combatants total — you always play *against the computer*, together).

## Limits and failure modes

- If the **host** leaves mid-match, the match dies with it (no host
  migration). Guests fall back to the menu.
- Late joins are rejected once status is `playing`.
- Rooms older than 24 h are deleted by `cleanup_stale_rooms()` (schedule it
  with pg_cron in production, see [DEPLOYMENT.md](DEPLOYMENT.md)).
- Multiplayer needs `fetch`/`WebSocket`, i.e. the web build.
