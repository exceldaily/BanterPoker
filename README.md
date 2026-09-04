# Banter Poker

Keep the chips. Keep the banter. Lose the deck.

Banter Poker is a digital deck and home poker table companion for in-person No Limit Texas Hold'em. Each player's phone becomes their two hole cards, a shared board syncs to every device, and a tournament clock keeps blinds and antes honest. Real chips, real betting and real table talk stay on the physical table. There is no money, no chip tracking, no pots and no betting controls (fold is the one exception, because the app needs to know which dealt hands are still alive).

## Stack

- Next.js 16, React 19, TypeScript (strict), Tailwind 4, Framer Motion
- Supabase Postgres (shared OrbitStack project, own `banterpoker` schema) + Supabase Realtime broadcast
- Installable PWA with a conservative service worker (private game data is never cached)

## How it is secured

- Nobody creates an account. Each browser gets a random device secret on first visit, stored in an httpOnly cookie by the Next.js server. The browser never sees it.
- Every privileged operation is a Postgres `SECURITY DEFINER` function that verifies the device secret and locks the game row. Tables carry RLS with no policies for the API roles, so the only surface is those functions (see `supabase/migrations/0003`).
- The deck is shuffled inside Postgres with `gen_random_bytes` (Fisher-Yates, rejection sampling). No client input can influence it.
- Hole cards leave the database only via `get_game_snapshot` for the owning device, or once a player explicitly shows. Hosts and dealer devices never receive them. Burn cards are never selected out by any function.
- Realtime carries only the public snapshot; private data is fetched over `/api/rpc`.

## Roles

| Device | Role | Cards | Controls |
| --- | --- | --- | --- |
| Player | `player` | own hand | fold, show, muck |
| Player + host | `player`, `can_control`, `is_host` | own hand | dealer + host controls |
| Dedicated dealer | `dealer`, `can_control` | none | dealer controls |
| Table display | token only | none | read only |

## Develop

```bash
pnpm install
cp .env.example .env.local   # public Supabase URL + publishable key only
pnpm dev                     # http://localhost:3010
```

Open `http://localhost:3010/dev` to spawn a fake table with N simulated players and drive a full game from one screen. The simulator is compiled out of production builds.

## Test

```bash
pnpm test               # unit: deck, shuffle, dealing order, positions, blinds, timer
pnpm test:integration   # against the real database over the anon key: full game, privacy, permissions, duplicate actions
pnpm typecheck && pnpm lint && pnpm build
```

## Database

Migrations live in `supabase/migrations/` and were applied to the shared project via the Supabase MCP in order (0001 schema, 0002 functions, 0003 security + PostgREST exposure, 0004 to 0006 hotfixes). The exposure step appends `banterpoker` to `pgrst.db_schemas` without touching sibling schemas.

## Deploy

Vercel project with two environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (plus `NEXT_PUBLIC_SITE_URL`). Health contract at `/api/health`.
