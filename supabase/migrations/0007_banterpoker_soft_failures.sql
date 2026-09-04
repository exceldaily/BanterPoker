-- =============================================================================
-- Banter Poker - durable rate limiting for code-guessing entry points
-- =============================================================================
-- A raised exception rolls back the whole call, including the rate_limits
-- upsert, so a brute-forcer probing join / pairing codes was never counted.
-- The code-lookup entry points now return {"error": CODE} for "not found"
-- instead of raising, which commits the counter. The Next.js layer converts
-- that payload into the same ApiError the UI already understands.
-- =============================================================================

create or replace function banterpoker.soft_fail(code text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('error', code);
$$;

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
    return banterpoker.soft_fail('GAME_NOT_FOUND');
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
    return banterpoker.soft_fail('GAME_NOT_FOUND');
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
    return banterpoker.soft_fail('PAIRING_INVALID');
  end if;
  g := banterpoker.lock_game(g.id);
  m := banterpoker.membership(g.id, p_device_id);
  if m.id is not null then
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
    return banterpoker.soft_fail('GAME_NOT_FOUND');
  end if;
  g := banterpoker.lock_game(g.id);
  select * into p from banterpoker.players where id = p_player_id and game_id = g.id and status <> 'removed';
  if p.id is null or p.device_id is not null then
    return banterpoker.soft_fail('CLAIM_NOT_AVAILABLE');
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
    return banterpoker.soft_fail('GAME_NOT_FOUND');
  end if;
  return banterpoker.public_snapshot(gid) || jsonb_build_object('me', jsonb_build_object('role', 'display'));
end;
$$;

revoke execute on function banterpoker.soft_fail(text) from public, anon, authenticated;
