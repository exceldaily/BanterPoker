-- =============================================================================
-- Banter Poker - honour allowStructureEdits at table creation
-- =============================================================================
-- Home games routinely "just double the blinds" mid-session, so the quick
-- blind actions in the tournament menu need structure edits to be allowed.
-- create_game now reads config.allowStructureEdits (default TRUE for new
-- tables); the host can still switch it off in settings.
-- =============================================================================

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
    allow_late_entry, auto_advance_levels, advance_after_hand, allow_structure_edits,
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
    coalesce((p_config->>'allowStructureEdits')::boolean, true),
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

-- Existing tables created before this change get the same convenience.
update banterpoker.games set allow_structure_edits = true where status <> 'complete';
