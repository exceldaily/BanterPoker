-- =============================================================================
-- Banter Poker - schema, enums, tables, indexes
-- =============================================================================
-- Banter Poker shares OrbitStack's Supabase project and owns exactly one
-- schema: `banterpoker`. It deliberately does NOT use Supabase Auth: players
-- never create accounts. Every device gets a random secret on first visit
-- (kept in an httpOnly cookie by the Next.js server) and every privileged
-- operation runs inside a SECURITY DEFINER function that verifies that secret.
--
-- Tables carry RLS with NO policies for the API roles, so the only way in or
-- out is through the functions in 0002. Hole cards therefore never leave the
-- database except through `get_game_snapshot` for the owning device, or when
-- a player explicitly shows their hand.
--
-- Nothing here tracks chips, pots, bets or money. Physical chips stay on the
-- physical table.
-- =============================================================================

create schema if not exists banterpoker;

grant usage on schema banterpoker to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type banterpoker.game_status as enum ('lobby', 'active', 'complete');
create type banterpoker.device_role as enum ('player', 'dealer');
create type banterpoker.player_status as enum ('active', 'sitting_out', 'eliminated', 'pending', 'removed');
create type banterpoker.hand_state as enum ('pre_flop', 'flop', 'turn', 'river', 'complete');
create type banterpoker.hand_player_status as enum ('in_hand', 'folded', 'shown', 'mucked');
create type banterpoker.level_type as enum ('play', 'break');
create type banterpoker.ante_type as enum ('none', 'standard', 'big_blind');
create type banterpoker.timer_mode as enum ('tournament', 'casual', 'none');
create type banterpoker.timer_status as enum ('idle', 'running', 'paused', 'expired');

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function banterpoker.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- devices: one row per browser/PWA install. secret_hash is sha256(secret).
-- -----------------------------------------------------------------------------

create table banterpoker.devices (
  id            uuid primary key default gen_random_uuid(),
  secret_hash   bytea not null,
  label         text,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- games
-- -----------------------------------------------------------------------------

create table banterpoker.games (
  id                          uuid primary key default gen_random_uuid(),
  join_code                   text not null unique,
  display_token               text not null unique,
  table_name                  text not null,
  max_seats                   int  not null check (max_seats between 2 and 12),
  status                      banterpoker.game_status not null default 'lobby',
  host_device_id              uuid not null references banterpoker.devices(id),
  seating_locked              boolean not null default false,
  allow_late_entry            boolean not null default true,
  auto_advance_levels         boolean not null default true,
  advance_after_hand          boolean not null default false,
  allow_structure_edits       boolean not null default false,
  sounds_enabled              boolean not null default true,
  haptics_enabled             boolean not null default true,
  timer_alerts_enabled        boolean not null default true,
  timer_mode                  banterpoker.timer_mode not null default 'tournament',
  casual_small_blind          int,
  casual_big_blind            int,
  casual_ante                 int,
  casual_ante_type            banterpoker.ante_type not null default 'none',
  current_hand_id             uuid,
  hand_count                  int not null default 0,
  dealer_seat                 int,
  current_level_id            uuid,
  timer_status                banterpoker.timer_status not null default 'idle',
  level_started_at            timestamptz,
  level_paused_at             timestamptz,
  level_remaining_at_pause    int,
  level_pending_advance       boolean not null default false,
  dealer_pairing_code         text,
  dealer_pairing_expires_at   timestamptz,
  winner_player_id            uuid,
  version                     bigint not null default 1,
  started_at                  timestamptz,
  ended_at                    timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index games_join_code_idx on banterpoker.games (join_code) where status <> 'complete';
create index games_pairing_idx on banterpoker.games (dealer_pairing_code) where dealer_pairing_code is not null;

create trigger games_updated_at before update on banterpoker.games
  for each row execute function banterpoker.set_updated_at();

-- -----------------------------------------------------------------------------
-- players: a seat-holder in a game. Dealer-only devices are NOT players.
-- -----------------------------------------------------------------------------

create table banterpoker.players (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references banterpoker.games(id) on delete cascade,
  device_id      uuid references banterpoker.devices(id),
  display_name   text not null check (char_length(display_name) between 1 and 24),
  seat_number    int check (seat_number between 1 and 12),
  status         banterpoker.player_status not null default 'active',
  joined_at      timestamptz not null default now(),
  eliminated_at  timestamptz,
  updated_at     timestamptz not null default now()
);

create unique index players_seat_unique on banterpoker.players (game_id, seat_number)
  where seat_number is not null and status <> 'removed';
create unique index players_device_unique on banterpoker.players (game_id, device_id)
  where device_id is not null and status <> 'removed';
create index players_game_idx on banterpoker.players (game_id);

create trigger players_updated_at before update on banterpoker.players
  for each row execute function banterpoker.set_updated_at();

alter table banterpoker.games
  add constraint games_winner_fk foreign key (winner_player_id) references banterpoker.players(id);

-- -----------------------------------------------------------------------------
-- game_devices: which devices are attached to a game and what they may do.
-- Permissions are deliberately separate:
--   role        player | dealer            (what the device IS)
--   can_control true for dealer controls   (hand progression, players, clock)
--   is_host     true for game administration (pair dealers, transfer, end)
-- A player-host is role=player, can_control=true, is_host=true.
-- A dedicated dealer is role=dealer, can_control=true, player_id null.
-- No combination ever grants reading another player's hole cards.
-- -----------------------------------------------------------------------------

create table banterpoker.game_devices (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references banterpoker.games(id) on delete cascade,
  device_id     uuid not null references banterpoker.devices(id),
  role          banterpoker.device_role not null,
  can_control   boolean not null default false,
  is_host       boolean not null default false,
  player_id     uuid references banterpoker.players(id),
  label         text,
  connected_at  timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (game_id, device_id)
);

create index game_devices_game_idx on banterpoker.game_devices (game_id);
create index game_devices_device_idx on banterpoker.game_devices (device_id);

-- -----------------------------------------------------------------------------
-- tournament_levels: each level has its own duration. `break` levels keep the
-- previous blinds and only count down.
-- -----------------------------------------------------------------------------

create table banterpoker.tournament_levels (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references banterpoker.games(id) on delete cascade,
  sort_order        int not null,
  level_type        banterpoker.level_type not null default 'play',
  small_blind       int not null default 0 check (small_blind >= 0),
  big_blind         int not null default 0 check (big_blind >= 0),
  ante              int not null default 0 check (ante >= 0),
  ante_type         banterpoker.ante_type not null default 'none',
  duration_seconds  int not null check (duration_seconds between 30 and 86400),
  unique (game_id, sort_order)
);

alter table banterpoker.games
  add constraint games_level_fk foreign key (current_level_id)
  references banterpoker.tournament_levels(id) on delete set null;

-- -----------------------------------------------------------------------------
-- hands + the private deck + per-player hand rows
-- -----------------------------------------------------------------------------

create table banterpoker.hands (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references banterpoker.games(id) on delete cascade,
  hand_number         int not null,
  dealer_seat         int not null,
  small_blind_seat    int not null,
  big_blind_seat      int not null,
  state               banterpoker.hand_state not null default 'pre_flop',
  board               text[] not null default '{}',
  players_dealt_in    int not null,
  created_at          timestamptz not null default now(),
  flop_at             timestamptz,
  turn_at             timestamptz,
  river_at            timestamptz,
  completed_at        timestamptz,
  unique (game_id, hand_number)
);

alter table banterpoker.games
  add constraint games_current_hand_fk foreign key (current_hand_id)
  references banterpoker.hands(id) on delete set null;

-- The shuffled deck. Only ever read by the dealing functions. Burn cards are
-- implied by position and are never selected out by any API.
create table banterpoker.hand_decks (
  hand_id      uuid primary key references banterpoker.hands(id) on delete cascade,
  cards        text[] not null check (cardinality(cards) = 52),
  deal_cursor  int not null default 0
);

create table banterpoker.hand_players (
  id           uuid primary key default gen_random_uuid(),
  hand_id      uuid not null references banterpoker.hands(id) on delete cascade,
  player_id    uuid not null references banterpoker.players(id) on delete cascade,
  seat_number  int not null,
  deal_order   int not null,
  status       banterpoker.hand_player_status not null default 'in_hand',
  card_1       text not null,
  card_2       text not null,
  folded_at    timestamptz,
  folded_by    text check (folded_by in ('player', 'dealer')),
  shown_at     timestamptz,
  unique (hand_id, player_id),
  unique (hand_id, seat_number)
);

create index hand_players_player_idx on banterpoker.hand_players (player_id);

-- -----------------------------------------------------------------------------
-- game_events: server-side audit/sync log. Never contains card values.
-- -----------------------------------------------------------------------------

create table banterpoker.game_events (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references banterpoker.games(id) on delete cascade,
  hand_id     uuid,
  event_type  text not null,
  device_id   uuid,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index game_events_game_idx on banterpoker.game_events (game_id, id);

-- -----------------------------------------------------------------------------
-- rate_limits: tiny fixed-window counter used by the public entry points.
-- -----------------------------------------------------------------------------

create table banterpoker.rate_limits (
  bucket        text primary key,
  hits          int not null default 0,
  window_start  timestamptz not null default now()
);
