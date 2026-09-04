-- =============================================================================
-- Banter Poker - RLS, grants, PostgREST exposure
-- =============================================================================
-- The API roles get ZERO table privileges and every table has RLS enabled with
-- no policies: a direct `select * from banterpoker.hand_players` through the
-- REST API returns a permission error before RLS is even consulted, and even
-- if a grant slipped through, RLS with no policies yields no rows.
--
-- The only surface is the set of SECURITY DEFINER functions from 0002, which
-- validate the device secret and return exactly what that device may see.
-- =============================================================================

alter table banterpoker.devices            enable row level security;
alter table banterpoker.games              enable row level security;
alter table banterpoker.players            enable row level security;
alter table banterpoker.game_devices       enable row level security;
alter table banterpoker.tournament_levels  enable row level security;
alter table banterpoker.hands              enable row level security;
alter table banterpoker.hand_decks         enable row level security;
alter table banterpoker.hand_players       enable row level security;
alter table banterpoker.game_events        enable row level security;
alter table banterpoker.rate_limits        enable row level security;

-- Belt and braces: even the table owner path stays RLS-checked for anyone but
-- the definer; force it so no future "bypass by owner" surprises.
alter table banterpoker.hand_decks   force row level security;
alter table banterpoker.hand_players force row level security;

revoke all on all tables in schema banterpoker from anon, authenticated;
revoke all on all sequences in schema banterpoker from anon, authenticated;
grant all on all tables in schema banterpoker to service_role;
grant usage on all sequences in schema banterpoker to service_role;

-- Functions: default-deny, then allow only the intended entry points.
revoke execute on all functions in schema banterpoker from public, anon, authenticated;

grant execute on function banterpoker.register_device(text, text)                       to anon, authenticated;
grant execute on function banterpoker.my_games(uuid, text)                               to anon, authenticated;
grant execute on function banterpoker.create_game(uuid, text, jsonb)                     to anon, authenticated;
grant execute on function banterpoker.lookup_game(uuid, text, text)                      to anon, authenticated;
grant execute on function banterpoker.join_game(uuid, text, text, text, text)            to anon, authenticated;
grant execute on function banterpoker.choose_seat(uuid, text, uuid, int)                 to anon, authenticated;
grant execute on function banterpoker.set_display_name(uuid, text, uuid, text)           to anon, authenticated;
grant execute on function banterpoker.leave_game(uuid, text, uuid)                       to anon, authenticated;
grant execute on function banterpoker.get_game_snapshot(uuid, text, uuid)                to anon, authenticated;
grant execute on function banterpoker.get_display_snapshot(text)                         to anon, authenticated;
grant execute on function banterpoker.set_seating_locked(uuid, text, uuid, boolean)      to anon, authenticated;
grant execute on function banterpoker.set_player_status(uuid, text, uuid, uuid, text)    to anon, authenticated;
grant execute on function banterpoker.move_player_seat(uuid, text, uuid, uuid, int)      to anon, authenticated;
grant execute on function banterpoker.set_dealer_seat(uuid, text, uuid, int)             to anon, authenticated;
grant execute on function banterpoker.create_dealer_pairing(uuid, text, uuid)            to anon, authenticated;
grant execute on function banterpoker.pair_dealer(uuid, text, text, text)                to anon, authenticated;
grant execute on function banterpoker.revoke_dealer(uuid, text, uuid, uuid)              to anon, authenticated;
grant execute on function banterpoker.disconnect_device(uuid, text, uuid, uuid)          to anon, authenticated;
grant execute on function banterpoker.claim_player(uuid, text, text, uuid)               to anon, authenticated;
grant execute on function banterpoker.transfer_host(uuid, text, uuid, uuid)              to anon, authenticated;
grant execute on function banterpoker.update_settings(uuid, text, uuid, jsonb)           to anon, authenticated;
grant execute on function banterpoker.replace_levels(uuid, text, uuid, jsonb)            to anon, authenticated;
grant execute on function banterpoker.start_game(uuid, text, uuid)                       to anon, authenticated;
grant execute on function banterpoker.start_hand(uuid, text, uuid)                       to anon, authenticated;
grant execute on function banterpoker.deal_flop(uuid, text, uuid)                        to anon, authenticated;
grant execute on function banterpoker.deal_turn(uuid, text, uuid)                        to anon, authenticated;
grant execute on function banterpoker.deal_river(uuid, text, uuid)                       to anon, authenticated;
grant execute on function banterpoker.end_hand(uuid, text, uuid)                         to anon, authenticated;
grant execute on function banterpoker.fold_hand(uuid, text, uuid)                        to anon, authenticated;
grant execute on function banterpoker.dealer_mark_folded(uuid, text, uuid, uuid)         to anon, authenticated;
grant execute on function banterpoker.show_hand(uuid, text, uuid)                        to anon, authenticated;
grant execute on function banterpoker.muck_hand(uuid, text, uuid)                        to anon, authenticated;
grant execute on function banterpoker.timer_action(uuid, text, uuid, text, int)          to anon, authenticated;
grant execute on function banterpoker.sync_timer(uuid, text, uuid)                       to anon, authenticated;
grant execute on function banterpoker.end_game(uuid, text, uuid, uuid)                   to anon, authenticated;
grant execute on function banterpoker.set_winner(uuid, text, uuid, uuid)                 to anon, authenticated;
grant execute on function banterpoker.get_events(uuid, text, uuid, bigint, int)          to anon, authenticated;

-- Internal helpers are callable only through the entry points above.
-- (deal_street, secure_shuffle, touch_game, public_snapshot etc. stay revoked.)

-- -----------------------------------------------------------------------------
-- Expose the schema through PostgREST, APPEND-SAFELY (shared project).
-- -----------------------------------------------------------------------------

do $$
declare
  current_schemas text;
begin
  select coalesce(
    (select regexp_replace(cfg, '^pgrst\.db_schemas=', '')
       from pg_db_role_setting s
       join pg_roles r on r.oid = s.setrole,
            lateral unnest(s.setconfig) as cfg
      where r.rolname = 'authenticator'
        and cfg like 'pgrst.db_schemas=%'
      limit 1),
    null
  ) into current_schemas;

  if current_schemas is null then
    raise exception 'pgrst.db_schemas is unreadable here; refusing to overwrite the shared list';
  end if;

  if position('banterpoker' in current_schemas) = 0 then
    current_schemas := current_schemas || ', banterpoker';
    execute format('alter role authenticator set pgrst.db_schemas = %L', current_schemas);
  end if;
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
