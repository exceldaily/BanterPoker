-- =============================================================================
-- Banter Poker - server-authoritative game logic
-- =============================================================================
-- Every function here is SECURITY DEFINER and is the ONLY way the API roles
-- can touch banterpoker tables (0003 grants nothing on the tables themselves).
--
-- Authorization model
--   * `auth_device(id, secret)`     - proves the caller owns a device.
--   * `require_control(game, dev)`  - dealer controls (hand, players, clock).
--   * `require_host(game, dev)`     - game administration.
--   * hole cards are returned ONLY by get_game_snapshot to the owning device,
--     or inside the public snapshot once a player has explicitly shown.
--
-- Concurrency
--   Every mutation locks the game row (`for update`) and re-validates state
--   inside the transaction, so a double-tapped DEAL FLOP or two dealer devices
--   racing each other can only ever produce ONE transition.
--
-- Sync
--   `touch_game` bumps games.version and broadcasts the PUBLIC snapshot on the
--   realtime topic `game:<id>` (never hole cards).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Error helper: all user-facing failures raise with a stable code in MESSAGE
-- so the Next.js layer can map them to copy without leaking SQL details.
-- -----------------------------------------------------------------------------

create or replace function banterpoker.fail(code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using message = code, errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- Cryptographically secure randomness (pgcrypto gen_random_bytes)
-- -----------------------------------------------------------------------------

-- Uniform integer in [1, n] using rejection sampling over 32 random bits.
create or replace function banterpoker.random_int(n int)
returns int
language plpgsql
volatile
set search_path = ''
as $$
declare
  r      bigint;
  b      bytea;
  span   constant bigint := 4294967296; -- 2^32
  lim    bigint;
begin
  if n < 1 then
    raise exception 'random_int: n must be >= 1';
  end if;
  if n = 1 then
    return 1;
  end if;
  lim := span - (span % n);
  loop
    b := extensions.gen_random_bytes(4);
    r := (get_byte(b, 0)::bigint << 24) | (get_byte(b, 1)::bigint << 16)
       | (get_byte(b, 2)::bigint << 8) | get_byte(b, 3)::bigint;
    if r < lim then
      return (r % n) + 1;
    end if;
  end loop;
end;
$$;

-- Random string from an unambiguous alphabet (no 0/O/1/I).
create or replace function banterpoker.random_code(len int)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out_text text := '';
  i int;
begin
  for i in 1..len loop
    out_text := out_text || substr(alphabet, banterpoker.random_int(32), 1);
  end loop;
  return out_text;
end;
$$;

-- URL-safe random token.
create or replace function banterpoker.random_token(bytes int)
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(bytes), 'base64'), '+/=', '-_');
$$;

-- The canonical 52-card deck: ranks A23456789TJQK x suits SHDC.
create or replace function banterpoker.fresh_deck()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_agg(r || s order by si, ri)
  from unnest(array['A','2','3','4','5','6','7','8','9','T','J','Q','K']) with ordinality as ranks(r, ri),
       unnest(array['S','H','D','C']) with ordinality as suits(s, si);
$$;

-- Fisher-Yates with unbiased random indices. Shuffles once per hand.
create or replace function banterpoker.secure_shuffle(cards text[])
returns text[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  arr text[] := cards;
  n   int := cardinality(cards);
  i   int;
  j   int;
  tmp text;
begin
  for i in reverse n..2 loop
    j := banterpoker.random_int(i);
    tmp := arr[i];
    arr[i] := arr[j];
    arr[j] := tmp;
  end loop;
  return arr;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rate limiting: fixed window keyed by caller-supplied bucket.
-- -----------------------------------------------------------------------------

create or replace function banterpoker.check_rate(p_bucket text, p_max_hits int, p_window_seconds int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  row_hits int;
begin
  insert into banterpoker.rate_limits as rl (bucket, hits, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
    set hits = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.hits + 1 end,
        window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end
  returning hits into row_hits;
  if row_hits > p_max_hits then
    perform banterpoker.fail('RATE_LIMITED');
  end if;
end;
$$;

create or replace function banterpoker.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-bp-client',
    'unknown'
  );
$$;

-- -----------------------------------------------------------------------------
-- Devices
-- -----------------------------------------------------------------------------

-- Creates a device and returns its secret exactly once.
create or replace function banterpoker.register_device(p_label text default null, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  new_id uuid;
begin
  perform banterpoker.check_rate('register:' || banterpoker.request_ip(), 60, 600);
  secret := banterpoker.random_token(32);
  insert into banterpoker.devices (secret_hash, label, user_agent)
  values (extensions.digest(secret, 'sha256'), left(p_label, 60), left(p_user_agent, 300))
  returning id into new_id;
  return jsonb_build_object('deviceId', new_id, 'secret', secret);
end;
$$;

-- Verifies a device secret. Raises DEVICE_INVALID on failure.
create or replace function banterpoker.auth_device(p_device_id uuid, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  if p_device_id is null or p_secret is null then
    perform banterpoker.fail('DEVICE_INVALID');
  end if;
  select (d.secret_hash = extensions.digest(p_secret, 'sha256')) into ok
    from banterpoker.devices d where d.id = p_device_id;
  if not coalesce(ok, false) then
    perform banterpoker.fail('DEVICE_INVALID');
  end if;
  update banterpoker.devices set last_seen_at = now()
   where id = p_device_id and last_seen_at < now() - interval '30 seconds';
  return p_device_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Membership / permission checks (assume the caller already authenticated)
-- -----------------------------------------------------------------------------

create or replace function banterpoker.membership(p_game_id uuid, p_device_id uuid)
returns banterpoker.game_devices
language sql
stable
set search_path = ''
as $$
  select gd.* from banterpoker.game_devices gd
   where gd.game_id = p_game_id and gd.device_id = p_device_id and gd.revoked_at is null;
$$;

create or replace function banterpoker.require_member(p_game_id uuid, p_device_id uuid)
returns banterpoker.game_devices
language plpgsql
set search_path = ''
as $$
declare
  m banterpoker.game_devices;
begin
  m := banterpoker.membership(p_game_id, p_device_id);
  if m.id is null then
    perform banterpoker.fail('NOT_IN_GAME');
  end if;
  update banterpoker.game_devices set last_seen_at = now()
   where id = m.id and last_seen_at < now() - interval '15 seconds';
  return m;
end;
$$;

create or replace function banterpoker.require_control(p_game_id uuid, p_device_id uuid)
returns banterpoker.game_devices
language plpgsql
set search_path = ''
as $$
declare
  m banterpoker.game_devices;
begin
  m := banterpoker.require_member(p_game_id, p_device_id);
  if not m.can_control then
    perform banterpoker.fail('NOT_AUTHORIZED');
  end if;
  return m;
end;
$$;

create or replace function banterpoker.require_host(p_game_id uuid, p_device_id uuid)
returns banterpoker.game_devices
language plpgsql
set search_path = ''
as $$
declare
  m banterpoker.game_devices;
begin
  m := banterpoker.require_member(p_game_id, p_device_id);
  if not m.is_host then
    perform banterpoker.fail('NOT_HOST');
  end if;
  return m;
end;
$$;

-- Locks the game row for the rest of the transaction and returns it.
create or replace function banterpoker.lock_game(p_game_id uuid)
returns banterpoker.games
language plpgsql
set search_path = ''
as $$
declare
  g banterpoker.games;
begin
  select * into g from banterpoker.games where id = p_game_id for update;
  if g.id is null then
    perform banterpoker.fail('GAME_NOT_FOUND');
  end if;
  return g;
end;
$$;

create or replace function banterpoker.log_event(
  p_game_id uuid, p_event text, p_device_id uuid, p_hand_id uuid default null, p_payload jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into banterpoker.game_events (game_id, hand_id, event_type, device_id, payload)
  values (p_game_id, p_hand_id, p_event, p_device_id, coalesce(p_payload, '{}'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- Tournament clock helpers. Clients count down locally from these timestamps.
-- -----------------------------------------------------------------------------

create or replace function banterpoker.level_duration(p_level_id uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select duration_seconds from banterpoker.tournament_levels where id = p_level_id;
$$;

create or replace function banterpoker.remaining_seconds(g banterpoker.games)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  dur int;
begin
  if g.current_level_id is null then
    return 0;
  end if;
  dur := banterpoker.level_duration(g.current_level_id);
  if g.timer_status = 'running' then
    return greatest(0, dur - extract(epoch from (clock_timestamp() - g.level_started_at)));
  elsif g.timer_status = 'paused' then
    return coalesce(g.level_remaining_at_pause, dur);
  elsif g.timer_status = 'expired' then
    return 0;
  end if;
  return dur;
end;
$$;

create or replace function banterpoker.next_level_id(p_game_id uuid, p_level_id uuid, p_direction int)
returns uuid
language sql
stable
set search_path = ''
as $$
  select l2.id
    from banterpoker.tournament_levels l1
    join banterpoker.tournament_levels l2
      on l2.game_id = l1.game_id
     and (case when p_direction > 0 then l2.sort_order > l1.sort_order else l2.sort_order < l1.sort_order end)
   where l1.id = p_level_id and l1.game_id = p_game_id
   order by (case when p_direction > 0 then l2.sort_order else -l2.sort_order end)
   limit 1;
$$;

-- Applies expiry rules based on the server clock. Safe to call from any
-- member at any time; idempotent.
create or replace function banterpoker.apply_timer_expiry(p_game_id uuid, p_device_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  g          banterpoker.games;
  dur        int;
  expiry_at  timestamptz;
  nxt        uuid;
  hand_open  boolean;
  guard      int := 0;
begin
  select * into g from banterpoker.games where id = p_game_id;
  if g.timer_mode <> 'tournament' or g.current_level_id is null then
    return;
  end if;

  loop
    guard := guard + 1;
    exit when guard > 50;
    exit when g.timer_status <> 'running';
    dur := banterpoker.level_duration(g.current_level_id);
    expiry_at := g.level_started_at + make_interval(secs => dur);
    exit when expiry_at > clock_timestamp();

    -- Level has run out.
    select exists (
      select 1 from banterpoker.hands h where h.id = g.current_hand_id and h.state <> 'complete'
    ) into hand_open;

    nxt := banterpoker.next_level_id(g.id, g.current_level_id, 1);

    if g.auto_advance_levels and nxt is not null and not (g.advance_after_hand and hand_open) then
      update banterpoker.games
         set current_level_id = nxt,
             level_started_at = expiry_at,
             level_pending_advance = false,
             level_remaining_at_pause = null,
             level_paused_at = null
       where id = g.id;
      perform banterpoker.log_event(g.id, 'LEVEL_ADVANCED', p_device_id, null,
        jsonb_build_object('levelId', nxt, 'automatic', true));
    else
      update banterpoker.games
         set timer_status = 'expired',
             level_pending_advance = (g.advance_after_hand and hand_open and nxt is not null)
       where id = g.id;
      perform banterpoker.log_event(g.id, 'LEVEL_COMPLETE', p_device_id, null,
        jsonb_build_object('levelId', g.current_level_id));
    end if;
    select * into g from banterpoker.games where id = p_game_id;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Snapshots
-- -----------------------------------------------------------------------------

-- Everything every device at the table may see. NEVER includes hidden hole
-- cards, the deck, or burn cards. Shown hands are included by design.
create or replace function banterpoker.public_snapshot(p_game_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  g    banterpoker.games;
  h    banterpoker.hands;
  out_json jsonb;
  players_json jsonb;
  levels_json jsonb;
  hand_json jsonb;
  remaining int;
  folded int;
begin
  select * into g from banterpoker.games where id = p_game_id;
  if g.id is null then
    return null;
  end if;

  if g.current_hand_id is not null then
    select * into h from banterpoker.hands where id = g.current_hand_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.display_name,
      'seat', p.seat_number,
      'status', p.status,
      'isHost', exists (select 1 from banterpoker.game_devices gd where gd.player_id = p.id and gd.is_host and gd.revoked_at is null),
      'hasDevice', p.device_id is not null,
      'lastSeenAt', (select max(gd.last_seen_at) from banterpoker.game_devices gd where gd.player_id = p.id and gd.revoked_at is null),
      'handStatus', hp.status,
      'shownCards', case when hp.status = 'shown' then jsonb_build_array(hp.card_1, hp.card_2) else null end
    ) order by p.seat_number nulls last, p.joined_at), '[]'::jsonb)
    into players_json
    from banterpoker.players p
    left join banterpoker.hand_players hp on hp.player_id = p.id and hp.hand_id = g.current_hand_id
   where p.game_id = g.id and p.status <> 'removed';

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'sortOrder', l.sort_order,
      'type', l.level_type,
      'smallBlind', l.small_blind,
      'bigBlind', l.big_blind,
      'ante', l.ante,
      'anteType', l.ante_type,
      'durationSeconds', l.duration_seconds
    ) order by l.sort_order), '[]'::jsonb)
    into levels_json
    from banterpoker.tournament_levels l where l.game_id = g.id;

  if h.id is not null then
    select count(*) filter (where hp.status in ('in_hand', 'shown', 'mucked')),
           count(*) filter (where hp.status = 'folded')
      into remaining, folded
      from banterpoker.hand_players hp where hp.hand_id = h.id;
    hand_json := jsonb_build_object(
      'id', h.id,
      'number', h.hand_number,
      'state', h.state,
      'dealerSeat', h.dealer_seat,
      'smallBlindSeat', h.small_blind_seat,
      'bigBlindSeat', h.big_blind_seat,
      'board', to_jsonb(h.board),
      'playersDealtIn', h.players_dealt_in,
      'playersRemaining', remaining,
      'playersFolded', folded,
      'createdAt', h.created_at,
      'completedAt', h.completed_at
    );
  else
    hand_json := null;
  end if;

  out_json := jsonb_build_object(
    'game', jsonb_build_object(
      'id', g.id,
      'tableName', g.table_name,
      'status', g.status,
      'maxSeats', g.max_seats,
      'seatingLocked', g.seating_locked,
      'allowLateEntry', g.allow_late_entry,
      'autoAdvanceLevels', g.auto_advance_levels,
      'advanceAfterHand', g.advance_after_hand,
      'allowStructureEdits', g.allow_structure_edits,
      'soundsEnabled', g.sounds_enabled,
      'hapticsEnabled', g.haptics_enabled,
      'timerAlertsEnabled', g.timer_alerts_enabled,
      'timerMode', g.timer_mode,
      'casual', jsonb_build_object(
        'smallBlind', g.casual_small_blind, 'bigBlind', g.casual_big_blind,
        'ante', g.casual_ante, 'anteType', g.casual_ante_type),
      'handCount', g.hand_count,
      'dealerSeat', g.dealer_seat,
      'winnerPlayerId', g.winner_player_id,
      'startedAt', g.started_at,
      'endedAt', g.ended_at,
      'version', g.version
    ),
    'players', players_json,
    'hand', hand_json,
    'tournament', jsonb_build_object(
      'levels', levels_json,
      'currentLevelId', g.current_level_id,
      'timerStatus', g.timer_status,
      'levelStartedAt', g.level_started_at,
      'pausedAt', g.level_paused_at,
      'remainingAtPause', g.level_remaining_at_pause,
      'remainingSeconds', floor(banterpoker.remaining_seconds(g)),
      'pendingAdvance', g.level_pending_advance,
      'serverNow', clock_timestamp()
    )
  );
  return out_json;
end;
$$;

-- Bumps the version and broadcasts the public snapshot to every device.
create or replace function banterpoker.touch_game(p_game_id uuid, p_reason text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  snap jsonb;
begin
  update banterpoker.games set version = version + 1 where id = p_game_id;
  snap := banterpoker.public_snapshot(p_game_id);
  perform realtime.send(
    snap || jsonb_build_object('reason', p_reason),
    'snapshot',
    'game:' || p_game_id::text,
    false
  );
end;
$$;

-- Full snapshot for an authenticated member: public data + the caller's own
-- role and (for players) their own hole cards. This is the ONLY function that
-- returns hidden hole cards, and only ever the caller's.
create or replace function banterpoker.get_game_snapshot(p_device_id uuid, p_secret text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       banterpoker.game_devices;
  g       banterpoker.games;
  p       banterpoker.players;
  hp      banterpoker.hand_players;
  snap    jsonb;
  me      jsonb;
  devices jsonb;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  m := banterpoker.require_member(p_game_id, p_device_id);
  perform banterpoker.apply_timer_expiry(p_game_id, p_device_id);
  select * into g from banterpoker.games where id = p_game_id;

  snap := banterpoker.public_snapshot(p_game_id);

  if m.player_id is not null then
    select * into p from banterpoker.players where id = m.player_id;
    if g.current_hand_id is not null then
      select * into hp from banterpoker.hand_players
       where hand_id = g.current_hand_id and player_id = m.player_id;
    end if;
  end if;

  me := jsonb_build_object(
    'deviceId', p_device_id,
    'role', m.role,
    'canControl', m.can_control,
    'isHost', m.is_host,
    'playerId', m.player_id,
    'name', p.display_name,
    'seat', p.seat_number,
    'status', p.status,
    'hand', case when hp.id is not null then jsonb_build_object(
        'status', hp.status,
        'cards', case when hp.status = 'folded' then null else jsonb_build_array(hp.card_1, hp.card_2) end
      ) else null end
  );

  snap := snap || jsonb_build_object('me', me);

  if m.can_control then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', gd.id,
        'deviceId', gd.device_id,
        'role', gd.role,
        'canControl', gd.can_control,
        'isHost', gd.is_host,
        'playerId', gd.player_id,
        'label', coalesce(gd.label, d.label),
        'lastSeenAt', gd.last_seen_at
      ) order by gd.connected_at), '[]'::jsonb)
      into devices
      from banterpoker.game_devices gd
      join banterpoker.devices d on d.id = gd.device_id
     where gd.game_id = p_game_id and gd.revoked_at is null;
    snap := snap || jsonb_build_object(
      'control', jsonb_build_object(
        'joinCode', g.join_code,
        'displayToken', g.display_token,
        'devices', devices,
        'dealerPairingCode', case when g.dealer_pairing_expires_at > now() then g.dealer_pairing_code else null end,
        'dealerPairingExpiresAt', case when g.dealer_pairing_expires_at > now() then g.dealer_pairing_expires_at else null end
      )
    );
  end if;

  return snap;
end;
$$;

-- Read-only public view for TABLE DISPLAY devices. No auth beyond the token.
create or replace function banterpoker.get_display_snapshot(p_display_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
begin
  perform banterpoker.check_rate('display:' || banterpoker.request_ip(), 600, 60);
  select id into gid from banterpoker.games where display_token = p_display_token;
  if gid is null then
    perform banterpoker.fail('GAME_NOT_FOUND');
  end if;
  return banterpoker.public_snapshot(gid) || jsonb_build_object('me', jsonb_build_object('role', 'display'));
end;
$$;

-- Games this device belongs to that have not ended (used for reconnect).
create or replace function banterpoker.my_games(p_device_id uuid, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'gameId', g.id, 'tableName', g.table_name, 'status', g.status,
      'role', gd.role, 'canControl', gd.can_control, 'isHost', gd.is_host,
      'playerId', gd.player_id, 'updatedAt', g.updated_at
    ) order by g.updated_at desc)
    from banterpoker.game_devices gd
    join banterpoker.games g on g.id = gd.game_id
    where gd.device_id = p_device_id and gd.revoked_at is null and g.status <> 'complete'
      and g.updated_at > now() - interval '2 days'
  ), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Level structure validation + write
-- -----------------------------------------------------------------------------

create or replace function banterpoker.write_levels(p_game_id uuid, p_levels jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  lvl jsonb;
  i int := 0;
  n int;
begin
  if p_levels is null or jsonb_typeof(p_levels) <> 'array' then
    perform banterpoker.fail('LEVELS_INVALID');
  end if;
  n := jsonb_array_length(p_levels);
  if n > 60 then
    perform banterpoker.fail('LEVELS_INVALID');
  end if;
  delete from banterpoker.tournament_levels where game_id = p_game_id;
  for lvl in select * from jsonb_array_elements(p_levels) loop
    i := i + 1;
    insert into banterpoker.tournament_levels
      (game_id, sort_order, level_type, small_blind, big_blind, ante, ante_type, duration_seconds)
    values (
      p_game_id, i,
      coalesce(lvl->>'type', 'play')::banterpoker.level_type,
      greatest(0, coalesce((lvl->>'smallBlind')::int, 0)),
      greatest(0, coalesce((lvl->>'bigBlind')::int, 0)),
      greatest(0, coalesce((lvl->>'ante')::int, 0)),
      coalesce(lvl->>'anteType', 'none')::banterpoker.ante_type,
      least(86400, greatest(30, coalesce((lvl->>'durationSeconds')::int, 1200)))
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Create / join
-- -----------------------------------------------------------------------------

-- p_config keys: tableName, maxSeats, mode ('play_host' | 'dealer'),
--   displayName (play_host), timerMode, levels[], casual{smallBlind,bigBlind,ante,anteType},
--   allowLateEntry, autoAdvanceLevels, advanceAfterHand, soundsEnabled, hapticsEnabled,
--   timerAlertsEnabled, deviceLabel
create or replace function banterpoker.create_game(p_device_id uuid, p_secret text, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid       uuid;
  code      text;
  mode      text;
  tname     text;
  seats     int;
  tmode     banterpoker.timer_mode;
  pid       uuid;
  attempts  int := 0;
  pname     text;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.check_rate('create:' || p_device_id::text, 20, 3600);

  mode := coalesce(p_config->>'mode', 'play_host');
  if mode not in ('play_host', 'dealer') then
    perform banterpoker.fail('MODE_INVALID');
  end if;
  tname := left(trim(coalesce(p_config->>'tableName', '')), 40);
  if tname = '' then tname := 'Home Game'; end if;
  seats := coalesce((p_config->>'maxSeats')::int, 8);
  if seats < 2 or seats > 12 then
    perform banterpoker.fail('SEATS_INVALID');
  end if;
  tmode := coalesce(p_config->>'timerMode', 'tournament')::banterpoker.timer_mode;

  loop
    attempts := attempts + 1;
    code := banterpoker.random_code(6);
    exit when not exists (select 1 from banterpoker.games where join_code = code);
    if attempts > 20 then
      perform banterpoker.fail('CODE_COLLISION');
    end if;
  end loop;

  insert into banterpoker.games (
    join_code, display_token, table_name, max_seats, host_device_id, timer_mode,
    casual_small_blind, casual_big_blind, casual_ante, casual_ante_type,
    allow_late_entry, auto_advance_levels, advance_after_hand,
    sounds_enabled, haptics_enabled, timer_alerts_enabled
  ) values (
    code, banterpoker.random_token(24), tname, seats, p_device_id, tmode,
    nullif((p_config->'casual'->>'smallBlind')::int, 0),
    nullif((p_config->'casual'->>'bigBlind')::int, 0),
    nullif((p_config->'casual'->>'ante')::int, 0),
    coalesce(p_config->'casual'->>'anteType', 'none')::banterpoker.ante_type,
    coalesce((p_config->>'allowLateEntry')::boolean, true),
    coalesce((p_config->>'autoAdvanceLevels')::boolean, true),
    coalesce((p_config->>'advanceAfterHand')::boolean, false),
    coalesce((p_config->>'soundsEnabled')::boolean, true),
    coalesce((p_config->>'hapticsEnabled')::boolean, true),
    coalesce((p_config->>'timerAlertsEnabled')::boolean, true)
  ) returning id into gid;

  if tmode = 'tournament' then
    perform banterpoker.write_levels(gid, coalesce(p_config->'levels', '[]'::jsonb));
    if not exists (select 1 from banterpoker.tournament_levels where game_id = gid) then
      perform banterpoker.fail('LEVELS_REQUIRED');
    end if;
  end if;

  if mode = 'play_host' then
    pname := left(trim(coalesce(p_config->>'displayName', '')), 24);
    if pname = '' then
      perform banterpoker.fail('NAME_REQUIRED');
    end if;
    insert into banterpoker.players (game_id, device_id, display_name)
    values (gid, p_device_id, pname) returning id into pid;
    insert into banterpoker.game_devices (game_id, device_id, role, can_control, is_host, player_id, label)
    values (gid, p_device_id, 'player', true, true, pid, left(p_config->>'deviceLabel', 60));
  else
    insert into banterpoker.game_devices (game_id, device_id, role, can_control, is_host, label)
    values (gid, p_device_id, 'dealer', true, true, coalesce(left(p_config->>'deviceLabel', 60), 'Dealer device'));
  end if;

  perform banterpoker.log_event(gid, 'GAME_CREATED', p_device_id, null, jsonb_build_object('mode', mode));
  perform banterpoker.touch_game(gid, 'created');

  return jsonb_build_object('gameId', gid, 'joinCode', code, 'playerId', pid, 'role', case when mode = 'dealer' then 'dealer' else 'player' end);
end;
$$;

-- Public lookup used by the join screen. Rate limited per device.
create or replace function banterpoker.lookup_game(p_device_id uuid, p_secret text, p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  seated int;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.check_rate('lookup:' || p_device_id::text, 30, 60);
  select * into g from banterpoker.games
   where join_code = upper(trim(p_join_code)) and status <> 'complete'
   order by created_at desc limit 1;
  if g.id is null then
    perform banterpoker.fail('GAME_NOT_FOUND');
  end if;
  select count(*) into seated from banterpoker.players
   where game_id = g.id and seat_number is not null and status <> 'removed';
  return jsonb_build_object(
    'gameId', g.id, 'tableName', g.table_name, 'status', g.status,
    'maxSeats', g.max_seats, 'seated', seated,
    'seatingLocked', g.seating_locked, 'allowLateEntry', g.allow_late_entry,
    'alreadyMember', banterpoker.membership(g.id, p_device_id) is not null
  );
end;
$$;

create or replace function banterpoker.join_game(p_device_id uuid, p_secret text, p_join_code text, p_display_name text, p_device_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g     banterpoker.games;
  m     banterpoker.game_devices;
  pid   uuid;
  pname text;
  seated int;
  pstatus banterpoker.player_status;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.check_rate('join:' || p_device_id::text, 30, 600);

  select id into g from banterpoker.games
   where join_code = upper(trim(p_join_code)) and status <> 'complete'
   order by created_at desc limit 1;
  if g.id is null then
    perform banterpoker.fail('GAME_NOT_FOUND');
  end if;
  g := banterpoker.lock_game(g.id);

  m := banterpoker.membership(g.id, p_device_id);
  if m.id is not null then
    return jsonb_build_object('gameId', g.id, 'playerId', m.player_id, 'role', m.role, 'rejoined', true);
  end if;

  pname := left(trim(coalesce(p_display_name, '')), 24);
  if pname = '' then
    perform banterpoker.fail('NAME_REQUIRED');
  end if;

  if g.status = 'complete' then
    perform banterpoker.fail('GAME_ENDED');
  end if;
  if g.seating_locked and not g.allow_late_entry then
    perform banterpoker.fail('SEATING_LOCKED');
  end if;

  select count(*) into seated from banterpoker.players
   where game_id = g.id and seat_number is not null and status <> 'removed';
  if seated >= g.max_seats then
    perform banterpoker.fail('TABLE_FULL');
  end if;

  pstatus := case when g.seating_locked then 'pending' else 'active' end;

  insert into banterpoker.players (game_id, device_id, display_name, status)
  values (g.id, p_device_id, pname, pstatus) returning id into pid;
  insert into banterpoker.game_devices (game_id, device_id, role, can_control, is_host, player_id, label)
  values (g.id, p_device_id, 'player', false, false, pid, left(p_device_label, 60));

  perform banterpoker.log_event(g.id, 'PLAYER_JOINED', p_device_id, null, jsonb_build_object('playerId', pid, 'late', g.seating_locked));
  perform banterpoker.touch_game(g.id, 'player_joined');
  return jsonb_build_object('gameId', g.id, 'playerId', pid, 'role', 'player', 'rejoined', false);
end;
$$;

create or replace function banterpoker.choose_seat(p_device_id uuid, p_secret text, p_game_id uuid, p_seat int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  m banterpoker.game_devices;
  p banterpoker.players;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  m := banterpoker.require_member(p_game_id, p_device_id);
  if m.player_id is null then
    perform banterpoker.fail('NOT_A_PLAYER');
  end if;
  select * into p from banterpoker.players where id = m.player_id;
  if p.status = 'removed' or p.status = 'eliminated' then
    perform banterpoker.fail('PLAYER_INACTIVE');
  end if;
  if g.status = 'complete' then
    perform banterpoker.fail('GAME_ENDED');
  end if;
  if p_seat is null or p_seat < 1 or p_seat > g.max_seats then
    perform banterpoker.fail('SEAT_INVALID');
  end if;
  -- Once seating is locked players may only take a seat if they are a pending late entry.
  if g.seating_locked and not (p.status = 'pending' and g.allow_late_entry) then
    perform banterpoker.fail('SEATING_LOCKED');
  end if;
  if exists (select 1 from banterpoker.players x where x.game_id = p_game_id and x.seat_number = p_seat and x.status <> 'removed' and x.id <> p.id) then
    perform banterpoker.fail('SEAT_TAKEN');
  end if;
  update banterpoker.players set seat_number = p_seat where id = p.id;
  perform banterpoker.log_event(p_game_id, 'PLAYER_SEATED', p_device_id, null, jsonb_build_object('playerId', p.id, 'seat', p_seat));
  perform banterpoker.touch_game(p_game_id, 'seated');
  return jsonb_build_object('seat', p_seat);
end;
$$;

create or replace function banterpoker.set_display_name(p_device_id uuid, p_secret text, p_game_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m banterpoker.game_devices;
  pname text;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.lock_game(p_game_id);
  m := banterpoker.require_member(p_game_id, p_device_id);
  if m.player_id is null then
    perform banterpoker.fail('NOT_A_PLAYER');
  end if;
  pname := left(trim(coalesce(p_name, '')), 24);
  if pname = '' then
    perform banterpoker.fail('NAME_REQUIRED');
  end if;
  update banterpoker.players set display_name = pname where id = m.player_id;
  perform banterpoker.touch_game(p_game_id, 'renamed');
end;
$$;

create or replace function banterpoker.leave_game(p_device_id uuid, p_secret text, p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  m banterpoker.game_devices;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  m := banterpoker.membership(p_game_id, p_device_id);
  if m.id is null then
    return;
  end if;
  if m.is_host then
    perform banterpoker.fail('HOST_CANNOT_LEAVE');
  end if;
  update banterpoker.game_devices set revoked_at = now() where id = m.id;
  if m.player_id is not null then
    update banterpoker.players set status = 'removed', seat_number = null where id = m.player_id;
  end if;
  perform banterpoker.log_event(p_game_id, 'PLAYER_LEFT', p_device_id, null, jsonb_build_object('playerId', m.player_id));
  perform banterpoker.touch_game(p_game_id, 'left');
end;
$$;

-- -----------------------------------------------------------------------------
-- Host: seating, players, devices
-- -----------------------------------------------------------------------------

create or replace function banterpoker.set_seating_locked(p_device_id uuid, p_secret text, p_game_id uuid, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  update banterpoker.games set seating_locked = p_locked where id = p_game_id;
  perform banterpoker.log_event(p_game_id, case when p_locked then 'SEATING_LOCKED' else 'SEATING_UNLOCKED' end, p_device_id);
  perform banterpoker.touch_game(p_game_id, 'seating');
end;
$$;

-- Player status changes by the dealer/host: active | sitting_out | eliminated | removed.
-- Approving a pending late entry = setting them active.
create or replace function banterpoker.set_player_status(p_device_id uuid, p_secret text, p_game_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  p banterpoker.players;
  ns banterpoker.player_status;
  ev text;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  select * into p from banterpoker.players where id = p_player_id and game_id = p_game_id;
  if p.id is null then
    perform banterpoker.fail('PLAYER_NOT_FOUND');
  end if;
  if p_status not in ('active', 'sitting_out', 'eliminated', 'removed') then
    perform banterpoker.fail('STATUS_INVALID');
  end if;
  ns := p_status::banterpoker.player_status;
  if ns = 'active' and p.seat_number is null then
    perform banterpoker.fail('SEAT_REQUIRED');
  end if;
  update banterpoker.players
     set status = ns,
         eliminated_at = case when ns = 'eliminated' then now() when ns = 'active' then null else eliminated_at end,
         seat_number = case when ns = 'removed' then null else seat_number end
   where id = p.id;
  if ns = 'removed' then
    update banterpoker.game_devices set revoked_at = now()
     where game_id = p_game_id and player_id = p.id and not is_host;
  end if;
  ev := case ns
    when 'eliminated' then 'PLAYER_ELIMINATED'
    when 'sitting_out' then 'PLAYER_SITTING_OUT'
    when 'removed' then 'PLAYER_REMOVED'
    else case when p.status in ('eliminated') then 'PLAYER_RESTORED' when p.status = 'pending' then 'LATE_ENTRY_APPROVED' else 'PLAYER_ACTIVE' end
  end;
  perform banterpoker.log_event(p_game_id, ev, p_device_id, null, jsonb_build_object('playerId', p.id, 'from', p.status, 'to', ns));
  perform banterpoker.touch_game(p_game_id, 'player_status');
end;
$$;

create or replace function banterpoker.move_player_seat(p_device_id uuid, p_secret text, p_game_id uuid, p_player_id uuid, p_seat int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  p banterpoker.players;
  other uuid;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  select * into p from banterpoker.players where id = p_player_id and game_id = p_game_id and status <> 'removed';
  if p.id is null then
    perform banterpoker.fail('PLAYER_NOT_FOUND');
  end if;
  if p_seat < 1 or p_seat > g.max_seats then
    perform banterpoker.fail('SEAT_INVALID');
  end if;
  if exists (select 1 from banterpoker.hands h where h.id = g.current_hand_id and h.state <> 'complete') then
    perform banterpoker.fail('HAND_IN_PROGRESS');
  end if;
  select id into other from banterpoker.players
   where game_id = p_game_id and seat_number = p_seat and status <> 'removed' and id <> p.id;
  -- Swap if occupied (three-step to satisfy the unique index).
  if other is not null then
    update banterpoker.players set seat_number = null where id = other;
  end if;
  update banterpoker.players set seat_number = p_seat where id = p.id;
  if other is not null then
    update banterpoker.players set seat_number = p.seat_number where id = other;
  end if;
  perform banterpoker.log_event(p_game_id, 'PLAYER_MOVED', p_device_id, null,
    jsonb_build_object('playerId', p.id, 'from', p.seat_number, 'to', p_seat, 'swappedWith', other));
  perform banterpoker.touch_game(p_game_id, 'moved');
end;
$$;

create or replace function banterpoker.set_dealer_seat(p_device_id uuid, p_secret text, p_game_id uuid, p_seat int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  if exists (select 1 from banterpoker.hands h where h.id = g.current_hand_id and h.state <> 'complete') then
    perform banterpoker.fail('HAND_IN_PROGRESS');
  end if;
  if not exists (select 1 from banterpoker.players where game_id = p_game_id and seat_number = p_seat and status = 'active') then
    perform banterpoker.fail('SEAT_NOT_ACTIVE');
  end if;
  update banterpoker.games set dealer_seat = p_seat where id = p_game_id;
  perform banterpoker.log_event(p_game_id, 'BUTTON_MOVED', p_device_id, null, jsonb_build_object('seat', p_seat, 'manual', true));
  perform banterpoker.touch_game(p_game_id, 'button');
end;
$$;

-- Host-only: generate a short-lived pairing code for a dealer device.
create or replace function banterpoker.create_dealer_pairing(p_device_id uuid, p_secret text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
  exp timestamptz;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.lock_game(p_game_id);
  perform banterpoker.require_host(p_game_id, p_device_id);
  code := banterpoker.random_code(6);
  exp := now() + interval '15 minutes';
  update banterpoker.games set dealer_pairing_code = code, dealer_pairing_expires_at = exp where id = p_game_id;
  perform banterpoker.log_event(p_game_id, 'DEALER_PAIRING_CREATED', p_device_id);
  perform banterpoker.touch_game(p_game_id, 'pairing');
  return jsonb_build_object('pairingCode', code, 'expiresAt', exp);
end;
$$;

-- A second device redeems the pairing code and becomes an authorized dealer.
create or replace function banterpoker.pair_dealer(p_device_id uuid, p_secret text, p_pairing_code text, p_device_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  m banterpoker.game_devices;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.check_rate('pair:' || p_device_id::text, 20, 600);
  select id into g from banterpoker.games
   where dealer_pairing_code = upper(trim(p_pairing_code)) and dealer_pairing_expires_at > now() and status <> 'complete'
   limit 1;
  if g.id is null then
    perform banterpoker.fail('PAIRING_INVALID');
  end if;
  g := banterpoker.lock_game(g.id);
  m := banterpoker.membership(g.id, p_device_id);
  if m.id is not null then
    -- Existing member (even a player) gains dealer control; role stays as is.
    update banterpoker.game_devices set can_control = true where id = m.id;
  else
    insert into banterpoker.game_devices (game_id, device_id, role, can_control, is_host, label)
    values (g.id, p_device_id, 'dealer', true, false, coalesce(left(p_device_label, 60), 'Dealer device'));
  end if;
  update banterpoker.games set dealer_pairing_code = null, dealer_pairing_expires_at = null where id = g.id;
  perform banterpoker.log_event(g.id, 'DEALER_AUTHORIZED', p_device_id);
  perform banterpoker.touch_game(g.id, 'dealer_paired');
  return jsonb_build_object('gameId', g.id, 'role', coalesce(m.role, 'dealer'));
end;
$$;

create or replace function banterpoker.revoke_dealer(p_device_id uuid, p_secret text, p_game_id uuid, p_target_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t banterpoker.game_devices;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.lock_game(p_game_id);
  perform banterpoker.require_host(p_game_id, p_device_id);
  t := banterpoker.membership(p_game_id, p_target_device_id);
  if t.id is null then
    perform banterpoker.fail('DEVICE_NOT_FOUND');
  end if;
  if t.is_host then
    perform banterpoker.fail('CANNOT_REVOKE_HOST');
  end if;
  if t.role = 'dealer' then
    update banterpoker.game_devices set revoked_at = now() where id = t.id;
  else
    update banterpoker.game_devices set can_control = false where id = t.id;
  end if;
  perform banterpoker.log_event(p_game_id, 'DEALER_REVOKED', p_device_id, null, jsonb_build_object('deviceId', p_target_device_id));
  perform banterpoker.touch_game(p_game_id, 'dealer_revoked');
end;
$$;

create or replace function banterpoker.disconnect_device(p_device_id uuid, p_secret text, p_game_id uuid, p_target_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t banterpoker.game_devices;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.lock_game(p_game_id);
  perform banterpoker.require_host(p_game_id, p_device_id);
  t := banterpoker.membership(p_game_id, p_target_device_id);
  if t.id is null then
    perform banterpoker.fail('DEVICE_NOT_FOUND');
  end if;
  if t.is_host then
    perform banterpoker.fail('CANNOT_REVOKE_HOST');
  end if;
  update banterpoker.game_devices set revoked_at = now() where id = t.id;
  -- The player stays seated (they can rejoin from another phone via the join code);
  -- their seat is not vacated by disconnecting a device.
  if t.player_id is not null then
    update banterpoker.players set device_id = null where id = t.player_id;
  end if;
  perform banterpoker.log_event(p_game_id, 'DEVICE_DISCONNECTED', p_device_id, null, jsonb_build_object('deviceId', p_target_device_id));
  perform banterpoker.touch_game(p_game_id, 'device_disconnected');
end;
$$;

-- Reclaim a seat from a new device (phone died). Requires the join code AND
-- the dealer to have disconnected the old device first (player.device_id null).
create or replace function banterpoker.claim_player(p_device_id uuid, p_secret text, p_join_code text, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  p banterpoker.players;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.check_rate('claim:' || p_device_id::text, 10, 600);
  select id into g from banterpoker.games where join_code = upper(trim(p_join_code)) and status <> 'complete' order by created_at desc limit 1;
  if g.id is null then
    perform banterpoker.fail('GAME_NOT_FOUND');
  end if;
  g := banterpoker.lock_game(g.id);
  select * into p from banterpoker.players where id = p_player_id and game_id = g.id and status <> 'removed';
  if p.id is null or p.device_id is not null then
    perform banterpoker.fail('CLAIM_NOT_AVAILABLE');
  end if;
  if banterpoker.membership(g.id, p_device_id) is not null then
    perform banterpoker.fail('ALREADY_MEMBER');
  end if;
  update banterpoker.players set device_id = p_device_id where id = p.id;
  insert into banterpoker.game_devices (game_id, device_id, role, can_control, is_host, player_id)
  values (g.id, p_device_id, 'player', false, false, p.id);
  perform banterpoker.log_event(g.id, 'PLAYER_RECLAIMED', p_device_id, null, jsonb_build_object('playerId', p.id));
  perform banterpoker.touch_game(g.id, 'reclaimed');
  return jsonb_build_object('gameId', g.id, 'playerId', p.id);
end;
$$;

create or replace function banterpoker.transfer_host(p_device_id uuid, p_secret text, p_game_id uuid, p_target_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me banterpoker.game_devices;
  t  banterpoker.game_devices;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.lock_game(p_game_id);
  me := banterpoker.require_host(p_game_id, p_device_id);
  t := banterpoker.membership(p_game_id, p_target_device_id);
  if t.id is null or t.id = me.id then
    perform banterpoker.fail('DEVICE_NOT_FOUND');
  end if;
  update banterpoker.game_devices set is_host = false, can_control = (role = 'dealer') where id = me.id;
  update banterpoker.game_devices set is_host = true, can_control = true where id = t.id;
  update banterpoker.games set host_device_id = p_target_device_id where id = p_game_id;
  perform banterpoker.log_event(p_game_id, 'HOST_TRANSFERRED', p_device_id, null, jsonb_build_object('to', p_target_device_id));
  perform banterpoker.touch_game(p_game_id, 'host_transferred');
end;
$$;

-- Patch a subset of settings. Keys mirror create_game config.
create or replace function banterpoker.update_settings(p_device_id uuid, p_secret text, p_game_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  update banterpoker.games set
    table_name            = coalesce(nullif(left(trim(p_patch->>'tableName'), 40), ''), table_name),
    allow_late_entry      = coalesce((p_patch->>'allowLateEntry')::boolean, allow_late_entry),
    auto_advance_levels   = coalesce((p_patch->>'autoAdvanceLevels')::boolean, auto_advance_levels),
    advance_after_hand    = coalesce((p_patch->>'advanceAfterHand')::boolean, advance_after_hand),
    allow_structure_edits = coalesce((p_patch->>'allowStructureEdits')::boolean, allow_structure_edits),
    sounds_enabled        = coalesce((p_patch->>'soundsEnabled')::boolean, sounds_enabled),
    haptics_enabled       = coalesce((p_patch->>'hapticsEnabled')::boolean, haptics_enabled),
    timer_alerts_enabled  = coalesce((p_patch->>'timerAlertsEnabled')::boolean, timer_alerts_enabled),
    casual_small_blind    = case when p_patch ? 'casualSmallBlind' then nullif((p_patch->>'casualSmallBlind')::int, 0) else casual_small_blind end,
    casual_big_blind      = case when p_patch ? 'casualBigBlind' then nullif((p_patch->>'casualBigBlind')::int, 0) else casual_big_blind end,
    casual_ante           = case when p_patch ? 'casualAnte' then nullif((p_patch->>'casualAnte')::int, 0) else casual_ante end,
    casual_ante_type      = coalesce((p_patch->>'casualAnteType')::banterpoker.ante_type, casual_ante_type),
    max_seats             = case when g.status = 'lobby' and (p_patch->>'maxSeats')::int between 2 and 12
                                   and not exists (select 1 from banterpoker.players x where x.game_id = p_game_id and x.seat_number > (p_patch->>'maxSeats')::int and x.status <> 'removed')
                                 then (p_patch->>'maxSeats')::int else max_seats end
  where id = p_game_id;
  perform banterpoker.log_event(p_game_id, 'SETTINGS_UPDATED', p_device_id, null, p_patch - 'tableName');
  perform banterpoker.touch_game(p_game_id, 'settings');
end;
$$;

-- Replace the blind structure. Allowed freely in the lobby; mid-game only when
-- allow_structure_edits is on. Keeps the clock on the same sort position.
create or replace function banterpoker.replace_levels(p_device_id uuid, p_secret text, p_game_id uuid, p_levels jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  cur_sort int;
  new_cur uuid;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  if g.status <> 'lobby' and not g.allow_structure_edits then
    perform banterpoker.fail('STRUCTURE_LOCKED');
  end if;
  select sort_order into cur_sort from banterpoker.tournament_levels where id = g.current_level_id;
  update banterpoker.games set current_level_id = null where id = p_game_id;
  perform banterpoker.write_levels(p_game_id, p_levels);
  if cur_sort is not null then
    select id into new_cur from banterpoker.tournament_levels where game_id = p_game_id and sort_order = cur_sort;
    if new_cur is null then
      select id into new_cur from banterpoker.tournament_levels where game_id = p_game_id order by sort_order desc limit 1;
    end if;
    update banterpoker.games set current_level_id = new_cur where id = p_game_id;
  end if;
  if g.timer_mode = 'tournament' and not exists (select 1 from banterpoker.tournament_levels where game_id = p_game_id) then
    perform banterpoker.fail('LEVELS_REQUIRED');
  end if;
  perform banterpoker.log_event(p_game_id, 'STRUCTURE_UPDATED', p_device_id, null, jsonb_build_object('levels', jsonb_array_length(p_levels)));
  perform banterpoker.touch_game(p_game_id, 'structure');
end;
$$;

-- -----------------------------------------------------------------------------
-- Game lifecycle
-- -----------------------------------------------------------------------------

create or replace function banterpoker.start_game(p_device_id uuid, p_secret text, p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  n int;
  first_level uuid;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  if g.status <> 'lobby' then
    perform banterpoker.fail('GAME_ALREADY_STARTED');
  end if;
  select count(*) into n from banterpoker.players where game_id = p_game_id and status = 'active' and seat_number is not null;
  if n < 2 then
    perform banterpoker.fail('NOT_ENOUGH_PLAYERS');
  end if;
  -- Unseated stragglers are parked as sitting out rather than blocking the start.
  update banterpoker.players set status = 'sitting_out' where game_id = p_game_id and seat_number is null and status in ('active', 'pending');

  select id into first_level from banterpoker.tournament_levels where game_id = p_game_id order by sort_order limit 1;

  update banterpoker.games
     set status = 'active',
         seating_locked = true,
         started_at = now(),
         current_level_id = first_level,
         timer_status = (case when g.timer_mode = 'tournament' and first_level is not null then 'running' else 'idle' end)::banterpoker.timer_status,
         level_started_at = case when g.timer_mode = 'tournament' and first_level is not null then now() else null end,
         dealer_seat = coalesce(g.dealer_seat, (select min(seat_number) from banterpoker.players where game_id = p_game_id and status = 'active'))
   where id = p_game_id;
  perform banterpoker.log_event(p_game_id, 'GAME_STARTED', p_device_id, null, jsonb_build_object('players', n));
  if first_level is not null and g.timer_mode = 'tournament' then
    perform banterpoker.log_event(p_game_id, 'LEVEL_STARTED', p_device_id, null, jsonb_build_object('levelId', first_level));
  end if;
  perform banterpoker.touch_game(p_game_id, 'game_started');
end;
$$;

-- Next active seat clockwise strictly after p_from (wrapping).
create or replace function banterpoker.next_active_seat(p_game_id uuid, p_from int)
returns int
language sql
stable
set search_path = ''
as $$
  select seat_number from banterpoker.players
   where game_id = p_game_id and status = 'active' and seat_number is not null
   order by (case when seat_number > coalesce(p_from, 0) then 0 else 1 end), seat_number
   limit 1;
$$;

-- Deals a brand-new hand: fresh 52-card crypto shuffle, two cards to every
-- active seated player clockwise from the button (one card each, then the
-- second), positions computed with correct heads-up rules.
create or replace function banterpoker.start_hand(p_device_id uuid, p_secret text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g        banterpoker.games;
  hid      uuid;
  deck     text[];
  seats    int[];
  n        int;
  button   int;
  sb       int;
  bb       int;
  i        int;
  pid      uuid;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  if g.status <> 'active' then
    perform banterpoker.fail('GAME_NOT_ACTIVE');
  end if;
  if exists (select 1 from banterpoker.hands h where h.id = g.current_hand_id and h.state <> 'complete') then
    perform banterpoker.fail('HAND_IN_PROGRESS');
  end if;

  -- Button: keep games.dealer_seat if that seat is still active, otherwise the
  -- next active seat clockwise from it.
  if exists (select 1 from banterpoker.players where game_id = p_game_id and seat_number = g.dealer_seat and status = 'active') then
    button := g.dealer_seat;
  else
    button := banterpoker.next_active_seat(p_game_id, g.dealer_seat);
  end if;
  if button is null then
    perform banterpoker.fail('NOT_ENOUGH_PLAYERS');
  end if;

  -- Deal order: clockwise starting with the seat after the button, ending on the button.
  select array_agg(seat_number order by (case when seat_number > button then 0 else 1 end), seat_number)
    into seats
    from banterpoker.players
   where game_id = p_game_id and status = 'active' and seat_number is not null;
  n := coalesce(cardinality(seats), 0);
  if n < 2 then
    perform banterpoker.fail('NOT_ENOUGH_PLAYERS');
  end if;

  if n = 2 then
    sb := button;                 -- heads-up: button posts the small blind
    bb := seats[1];               -- the other player is the big blind
  else
    sb := seats[1];
    bb := seats[2];
  end if;

  deck := banterpoker.secure_shuffle(banterpoker.fresh_deck());

  insert into banterpoker.hands (game_id, hand_number, dealer_seat, small_blind_seat, big_blind_seat, players_dealt_in)
  values (p_game_id, g.hand_count + 1, button, sb, bb, n)
  returning id into hid;

  insert into banterpoker.hand_decks (hand_id, cards, deal_cursor) values (hid, deck, 2 * n);

  for i in 1..n loop
    select id into pid from banterpoker.players where game_id = p_game_id and seat_number = seats[i] and status = 'active';
    insert into banterpoker.hand_players (hand_id, player_id, seat_number, deal_order, card_1, card_2)
    values (hid, pid, seats[i], i, deck[i], deck[n + i]);
  end loop;

  update banterpoker.games
     set current_hand_id = hid, hand_count = g.hand_count + 1, dealer_seat = button
   where id = p_game_id;

  perform banterpoker.log_event(p_game_id, 'HAND_STARTED', p_device_id, hid,
    jsonb_build_object('handNumber', g.hand_count + 1, 'dealerSeat', button, 'players', n));
  perform banterpoker.touch_game(p_game_id, 'hand_started');
  return jsonb_build_object('handId', hid, 'handNumber', g.hand_count + 1);
end;
$$;

-- Shared street dealer. Burns one, deals `count`, moves exactly one state.
create or replace function banterpoker.deal_street(p_device_id uuid, p_secret text, p_game_id uuid, p_from banterpoker.hand_state, p_to banterpoker.hand_state, p_count int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g      banterpoker.games;
  h      banterpoker.hands;
  d      banterpoker.hand_decks;
  cards  text[];
  cursor_after int;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  if g.current_hand_id is null then
    perform banterpoker.fail('NO_HAND');
  end if;
  select * into h from banterpoker.hands where id = g.current_hand_id for update;
  if h.state <> p_from then
    perform banterpoker.fail('INVALID_TRANSITION');
  end if;
  select * into d from banterpoker.hand_decks where hand_id = h.id for update;
  -- burn one (position deal_cursor + 1), then deal p_count.
  cards := d.cards[(d.deal_cursor + 2):(d.deal_cursor + 1 + p_count)];
  cursor_after := d.deal_cursor + 1 + p_count;
  update banterpoker.hand_decks set deal_cursor = cursor_after where hand_id = h.id;
  update banterpoker.hands
     set state = p_to,
         board = h.board || cards,
         flop_at = case when p_to = 'flop' then now() else flop_at end,
         turn_at = case when p_to = 'turn' then now() else turn_at end,
         river_at = case when p_to = 'river' then now() else river_at end
   where id = h.id;
  perform banterpoker.log_event(p_game_id, upper(p_to::text) || '_DEALT', p_device_id, h.id, jsonb_build_object('boardSize', cardinality(h.board) + p_count));
  perform banterpoker.touch_game(p_game_id, p_to::text);
  return jsonb_build_object('state', p_to, 'board', to_jsonb(h.board || cards));
end;
$$;

create or replace function banterpoker.deal_flop(p_device_id uuid, p_secret text, p_game_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select banterpoker.deal_street(p_device_id, p_secret, p_game_id, 'pre_flop', 'flop', 3);
$$;

create or replace function banterpoker.deal_turn(p_device_id uuid, p_secret text, p_game_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select banterpoker.deal_street(p_device_id, p_secret, p_game_id, 'flop', 'turn', 1);
$$;

create or replace function banterpoker.deal_river(p_device_id uuid, p_secret text, p_game_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select banterpoker.deal_street(p_device_id, p_secret, p_game_id, 'turn', 'river', 1);
$$;

-- Ends the current hand at any street. Unused cards stay secret. Rotates the
-- button, and activates a pending level if "advance after hand" is waiting.
create or replace function banterpoker.end_hand(p_device_id uuid, p_secret text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g   banterpoker.games;
  h   banterpoker.hands;
  nxt uuid;
  next_button int;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  if g.current_hand_id is null then
    perform banterpoker.fail('NO_HAND');
  end if;
  select * into h from banterpoker.hands where id = g.current_hand_id for update;
  if h.state = 'complete' then
    perform banterpoker.fail('INVALID_TRANSITION');
  end if;
  update banterpoker.hands set state = 'complete', completed_at = now() where id = h.id;

  next_button := banterpoker.next_active_seat(p_game_id, h.dealer_seat);
  update banterpoker.games set dealer_seat = coalesce(next_button, h.dealer_seat) where id = p_game_id;
  perform banterpoker.log_event(p_game_id, 'HAND_ENDED', p_device_id, h.id, jsonb_build_object('endedAt', h.state));
  perform banterpoker.log_event(p_game_id, 'BUTTON_MOVED', p_device_id, null, jsonb_build_object('seat', next_button, 'manual', false));

  -- A level that completed during this hand becomes active now.
  if g.level_pending_advance then
    nxt := banterpoker.next_level_id(p_game_id, g.current_level_id, 1);
    if nxt is not null then
      update banterpoker.games
         set current_level_id = nxt, timer_status = 'running', level_started_at = now(),
             level_pending_advance = false, level_remaining_at_pause = null, level_paused_at = null
       where id = p_game_id;
      perform banterpoker.log_event(p_game_id, 'LEVEL_ADVANCED', p_device_id, null, jsonb_build_object('levelId', nxt, 'afterHand', true));
    else
      update banterpoker.games set level_pending_advance = false where id = p_game_id;
    end if;
  end if;

  perform banterpoker.touch_game(p_game_id, 'hand_ended');
  return jsonb_build_object('handId', h.id, 'nextDealerSeat', next_button);
end;
$$;

-- Player folds their own hand. Cards become inaccessible for this hand.
create or replace function banterpoker.fold_hand(p_device_id uuid, p_secret text, p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g  banterpoker.games;
  m  banterpoker.game_devices;
  hp banterpoker.hand_players;
  h  banterpoker.hands;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  m := banterpoker.require_member(p_game_id, p_device_id);
  if m.player_id is null then
    perform banterpoker.fail('NOT_A_PLAYER');
  end if;
  select * into h from banterpoker.hands where id = g.current_hand_id;
  if h.id is null or h.state = 'complete' then
    perform banterpoker.fail('NO_HAND');
  end if;
  select * into hp from banterpoker.hand_players where hand_id = h.id and player_id = m.player_id for update;
  if hp.id is null then
    perform banterpoker.fail('NOT_IN_HAND');
  end if;
  if hp.status = 'folded' then
    return; -- idempotent
  end if;
  if hp.status = 'shown' then
    perform banterpoker.fail('ALREADY_SHOWN');
  end if;
  update banterpoker.hand_players set status = 'folded', folded_at = now(), folded_by = 'player' where id = hp.id;
  perform banterpoker.log_event(p_game_id, 'PLAYER_FOLDED', p_device_id, h.id, jsonb_build_object('playerId', m.player_id, 'seat', hp.seat_number));
  perform banterpoker.touch_game(p_game_id, 'folded');
end;
$$;

-- Dealer emergency override: mark another player folded (phone died etc).
create or replace function banterpoker.dealer_mark_folded(p_device_id uuid, p_secret text, p_game_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g  banterpoker.games;
  hp banterpoker.hand_players;
  h  banterpoker.hands;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  select * into h from banterpoker.hands where id = g.current_hand_id;
  if h.id is null or h.state = 'complete' then
    perform banterpoker.fail('NO_HAND');
  end if;
  select * into hp from banterpoker.hand_players where hand_id = h.id and player_id = p_player_id for update;
  if hp.id is null then
    perform banterpoker.fail('NOT_IN_HAND');
  end if;
  if hp.status = 'folded' then
    return;
  end if;
  update banterpoker.hand_players set status = 'folded', folded_at = now(), folded_by = 'dealer' where id = hp.id;
  perform banterpoker.log_event(p_game_id, 'DEALER_MARKED_PLAYER_FOLDED', p_device_id, h.id, jsonb_build_object('playerId', p_player_id, 'seat', hp.seat_number));
  perform banterpoker.touch_game(p_game_id, 'folded');
end;
$$;

-- Player reveals their own hand to the table for this hand (during play or
-- after END HAND, until the next hand starts). Irreversible.
create or replace function banterpoker.show_hand(p_device_id uuid, p_secret text, p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g  banterpoker.games;
  m  banterpoker.game_devices;
  hp banterpoker.hand_players;
  h  banterpoker.hands;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  m := banterpoker.require_member(p_game_id, p_device_id);
  if m.player_id is null then
    perform banterpoker.fail('NOT_A_PLAYER');
  end if;
  -- Showing is allowed during the hand and after END HAND, until the next hand
  -- replaces this one as the game's current hand.
  select * into h from banterpoker.hands where id = g.current_hand_id;
  if h.id is null then
    perform banterpoker.fail('NO_HAND');
  end if;
  select * into hp from banterpoker.hand_players where hand_id = h.id and player_id = m.player_id for update;
  if hp.id is null then
    perform banterpoker.fail('NOT_IN_HAND');
  end if;
  if hp.status = 'folded' then
    perform banterpoker.fail('ALREADY_FOLDED');
  end if;
  if hp.status = 'shown' then
    return;
  end if;
  update banterpoker.hand_players set status = 'shown', shown_at = now() where id = hp.id;
  perform banterpoker.log_event(p_game_id, 'HAND_SHOWN', p_device_id, h.id, jsonb_build_object('playerId', m.player_id, 'seat', hp.seat_number));
  perform banterpoker.touch_game(p_game_id, 'shown');
end;
$$;

-- Player declares they keep their cards private (purely informational).
create or replace function banterpoker.muck_hand(p_device_id uuid, p_secret text, p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g  banterpoker.games;
  m  banterpoker.game_devices;
  hp banterpoker.hand_players;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  m := banterpoker.require_member(p_game_id, p_device_id);
  if m.player_id is null then
    perform banterpoker.fail('NOT_A_PLAYER');
  end if;
  select * into hp from banterpoker.hand_players where hand_id = g.current_hand_id and player_id = m.player_id for update;
  if hp.id is null then
    perform banterpoker.fail('NOT_IN_HAND');
  end if;
  if hp.status = 'in_hand' then
    update banterpoker.hand_players set status = 'mucked' where id = hp.id;
    perform banterpoker.log_event(p_game_id, 'HAND_MUCKED', p_device_id, g.current_hand_id, jsonb_build_object('playerId', m.player_id));
    perform banterpoker.touch_game(p_game_id, 'mucked');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tournament clock controls (dealer/host only)
-- -----------------------------------------------------------------------------

create or replace function banterpoker.timer_action(p_device_id uuid, p_secret text, p_game_id uuid, p_action text, p_arg int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g    banterpoker.games;
  dur  int;
  rem  numeric;
  tgt  uuid;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_control(p_game_id, p_device_id);
  perform banterpoker.apply_timer_expiry(p_game_id, p_device_id);
  select * into g from banterpoker.games where id = p_game_id;
  if g.timer_mode <> 'tournament' then
    perform banterpoker.fail('NO_TIMER');
  end if;
  if g.current_level_id is null then
    select id into tgt from banterpoker.tournament_levels where game_id = p_game_id order by sort_order limit 1;
    if tgt is null then
      perform banterpoker.fail('LEVELS_REQUIRED');
    end if;
    update banterpoker.games set current_level_id = tgt, timer_status = 'paused', level_remaining_at_pause = banterpoker.level_duration(tgt) where id = p_game_id;
    select * into g from banterpoker.games where id = p_game_id;
  end if;
  dur := banterpoker.level_duration(g.current_level_id);
  rem := banterpoker.remaining_seconds(g);

  case p_action
    when 'pause' then
      if g.timer_status = 'running' then
        update banterpoker.games set timer_status = 'paused', level_paused_at = now(), level_remaining_at_pause = ceil(rem) where id = p_game_id;
        perform banterpoker.log_event(p_game_id, 'LEVEL_PAUSED', p_device_id);
      end if;
    when 'resume' then
      if g.timer_status = 'paused' then
        update banterpoker.games
           set timer_status = 'running',
               level_started_at = now() - make_interval(secs => dur - coalesce(g.level_remaining_at_pause, dur)),
               level_paused_at = null, level_remaining_at_pause = null
         where id = p_game_id;
        perform banterpoker.log_event(p_game_id, 'LEVEL_RESUMED', p_device_id);
      elsif g.timer_status = 'expired' then
        -- Resume from an expired level = start the next one.
        tgt := banterpoker.next_level_id(p_game_id, g.current_level_id, 1);
        if tgt is null then
          perform banterpoker.fail('NO_NEXT_LEVEL');
        end if;
        update banterpoker.games set current_level_id = tgt, timer_status = 'running', level_started_at = now(),
               level_pending_advance = false, level_paused_at = null, level_remaining_at_pause = null where id = p_game_id;
        perform banterpoker.log_event(p_game_id, 'LEVEL_ADVANCED', p_device_id, null, jsonb_build_object('levelId', tgt, 'manual', true));
      end if;
    when 'next', 'prev' then
      tgt := banterpoker.next_level_id(p_game_id, g.current_level_id, case when p_action = 'next' then 1 else -1 end);
      if tgt is null then
        perform banterpoker.fail(case when p_action = 'next' then 'NO_NEXT_LEVEL' else 'NO_PREV_LEVEL' end);
      end if;
      update banterpoker.games
         set current_level_id = tgt,
             timer_status = (case when g.timer_status = 'paused' then 'paused' else 'running' end)::banterpoker.timer_status,
             level_started_at = now(),
             level_remaining_at_pause = case when g.timer_status = 'paused' then banterpoker.level_duration(tgt) else null end,
             level_paused_at = case when g.timer_status = 'paused' then now() else null end,
             level_pending_advance = false
       where id = p_game_id;
      perform banterpoker.log_event(p_game_id, 'LEVEL_ADVANCED', p_device_id, null, jsonb_build_object('levelId', tgt, 'manual', true, 'direction', p_action));
    when 'reset' then
      update banterpoker.games
         set timer_status = (case when g.timer_status = 'paused' then 'paused' else 'running' end)::banterpoker.timer_status,
             level_started_at = now(),
             level_remaining_at_pause = case when g.timer_status = 'paused' then dur else null end,
             level_pending_advance = false
       where id = p_game_id;
      perform banterpoker.log_event(p_game_id, 'LEVEL_RESET', p_device_id);
    when 'add_seconds' then
      if p_arg is null or abs(p_arg) > 3600 then
        perform banterpoker.fail('ARG_INVALID');
      end if;
      if g.timer_status = 'running' then
        update banterpoker.games set level_started_at = level_started_at + make_interval(secs => p_arg) where id = p_game_id;
      elsif g.timer_status = 'paused' then
        update banterpoker.games set level_remaining_at_pause = greatest(0, coalesce(level_remaining_at_pause, dur) + p_arg) where id = p_game_id;
      elsif g.timer_status = 'expired' and p_arg > 0 then
        update banterpoker.games set timer_status = 'running', level_started_at = now() - make_interval(secs => dur - p_arg), level_pending_advance = false where id = p_game_id;
      end if;
      perform banterpoker.log_event(p_game_id, 'LEVEL_TIME_ADJUSTED', p_device_id, null, jsonb_build_object('seconds', p_arg));
    else
      perform banterpoker.fail('ACTION_INVALID');
  end case;

  -- Adding time to a running level may have "un-expired" it; clamp state.
  select * into g from banterpoker.games where id = p_game_id;
  if g.timer_status = 'running' and banterpoker.remaining_seconds(g) <= 0 then
    perform banterpoker.apply_timer_expiry(p_game_id, p_device_id);
  end if;

  perform banterpoker.touch_game(p_game_id, 'timer');
  select * into g from banterpoker.games where id = p_game_id;
  return jsonb_build_object('timerStatus', g.timer_status, 'remainingSeconds', floor(banterpoker.remaining_seconds(g)), 'currentLevelId', g.current_level_id);
end;
$$;

-- Any member may ask the server to apply expiry (called when a client's local
-- countdown hits zero). Idempotent; broadcasts only if something changed.
create or replace function banterpoker.sync_timer(p_device_id uuid, p_secret text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  before_v bigint;
  before_status banterpoker.timer_status;
  before_level uuid;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_member(p_game_id, p_device_id);
  before_v := g.version; before_status := g.timer_status; before_level := g.current_level_id;
  perform banterpoker.apply_timer_expiry(p_game_id, p_device_id);
  select * into g from banterpoker.games where id = p_game_id;
  if g.timer_status is distinct from before_status or g.current_level_id is distinct from before_level then
    perform banterpoker.touch_game(p_game_id, 'timer_sync');
  end if;
  return jsonb_build_object('timerStatus', g.timer_status, 'currentLevelId', g.current_level_id, 'remainingSeconds', floor(banterpoker.remaining_seconds(g)));
end;
$$;

create or replace function banterpoker.end_game(p_device_id uuid, p_secret text, p_game_id uuid, p_winner_player_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_host(p_game_id, p_device_id);
  if g.status = 'complete' then
    return jsonb_build_object('alreadyEnded', true);
  end if;
  if p_winner_player_id is not null and not exists (select 1 from banterpoker.players where id = p_winner_player_id and game_id = p_game_id) then
    perform banterpoker.fail('PLAYER_NOT_FOUND');
  end if;
  update banterpoker.hands set state = 'complete', completed_at = now() where id = g.current_hand_id and state <> 'complete';
  update banterpoker.games
     set status = 'complete', ended_at = now(), winner_player_id = p_winner_player_id,
         timer_status = case when timer_status = 'running' then 'paused' else timer_status end,
         level_remaining_at_pause = case when timer_status = 'running' then ceil(banterpoker.remaining_seconds(g)) else level_remaining_at_pause end
   where id = p_game_id;
  perform banterpoker.log_event(p_game_id, 'GAME_ENDED', p_device_id, null, jsonb_build_object('winnerPlayerId', p_winner_player_id, 'hands', g.hand_count));
  perform banterpoker.touch_game(p_game_id, 'game_ended');
  return jsonb_build_object('ended', true);
end;
$$;

create or replace function banterpoker.set_winner(p_device_id uuid, p_secret text, p_game_id uuid, p_winner_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.lock_game(p_game_id);
  perform banterpoker.require_host(p_game_id, p_device_id);
  if p_winner_player_id is not null and not exists (select 1 from banterpoker.players where id = p_winner_player_id and game_id = p_game_id) then
    perform banterpoker.fail('PLAYER_NOT_FOUND');
  end if;
  update banterpoker.games set winner_player_id = p_winner_player_id where id = p_game_id;
  perform banterpoker.touch_game(p_game_id, 'winner');
end;
$$;

-- Recent public events for the dealer's log view. No card values ever.
create or replace function banterpoker.get_events(p_device_id uuid, p_secret text, p_game_id uuid, p_after bigint default 0, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.require_control(p_game_id, p_device_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.event_type, 'handId', e.hand_id, 'payload', e.payload, 'at', e.created_at) order by e.id desc)
    from (select * from banterpoker.game_events where game_id = p_game_id and id > p_after order by id desc limit least(p_limit, 500)) e
  ), '[]'::jsonb);
end;
$$;
