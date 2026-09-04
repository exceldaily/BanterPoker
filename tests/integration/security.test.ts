import { describe, expect, it } from "vitest";
import { as, expectCode, makeTable, mint, restSelect, rpc } from "./client";

// Security expectations enforced by the database, probed with the public anon
// key exactly as an attacker with the app bundle would have it.

describe("RLS / grants: the API roles cannot touch tables", () => {
  for (const table of ["devices", "games", "players", "game_devices", "tournament_levels", "hands", "hand_decks", "hand_players", "game_events", "rate_limits"]) {
    it(`denies SELECT on ${table}`, async () => {
      const res = await restSelect(table);
      expect([401, 403, 404]).toContain(res.status);
    });
  }

  it("denies internal helper functions", async () => {
    for (const fn of ["fresh_deck", "secure_shuffle", "public_snapshot", "touch_game", "deal_street", "auth_device", "apply_timer_expiry"]) {
      await expect(rpc(fn, {})).rejects.toBeTruthy();
    }
  });
});

describe("device identity", () => {
  it("rejects a wrong secret and a fake device id", async () => {
    const d = await mint("real");
    await expectCode(rpc("my_games", { p_device_id: d.deviceId, p_secret: "x".repeat(43) }), "DEVICE_INVALID");
    await expectCode(rpc("my_games", { p_device_id: "00000000-0000-4000-8000-000000000000", p_secret: d.secret }), "DEVICE_INVALID");
  });
});

describe("hole-card privacy and host authorization", () => {
  it("no role can read another player's hidden cards; dealer actions require control; host actions require host", async () => {
    const t = await makeTable({ mode: "play_host", players: 3 });
    const host = as(t.host);
    const gid = t.gameId;
    const stranger = await mint("stranger");

    // Non-member cannot read the game at all.
    await expectCode(as(stranger).snapshot(gid), "NOT_IN_GAME");
    await expectCode(as(stranger).call("deal_flop", { p_game_id: gid }), "NOT_IN_GAME");

    await host.call("start_game", { p_game_id: gid });
    await host.call("start_hand", { p_game_id: gid });

    const hostSnap = await host.snapshot(gid);
    const p1 = as(t.players[0]!.device);
    const p1Snap = await p1.snapshot(gid);
    const p1Cards = p1Snap.me.hand!.cards!;

    // Host is a player: sees own cards, never p1's. (The control block holds
    // random codes that can coincidentally spell a card id, so it is excluded
    // from the substring sweep and checked structurally instead.)
    const leak = (s: object) => JSON.stringify({ ...s, control: undefined });
    expect(hostSnap.me.hand?.cards).toHaveLength(2);
    expect(leak(hostSnap)).not.toContain(p1Cards[0]);
    expect(leak(hostSnap)).not.toContain(p1Cards[1]);
    expect(JSON.stringify(hostSnap.control)).not.toMatch(/"card|shownCards|hand_decks/);
    // p1 never sees host's cards.
    for (const c of hostSnap.me.hand!.cards!) expect(leak(p1Snap)).not.toContain(c);
    // Player snapshots carry no control block (join code, devices).
    expect(p1Snap.control).toBeUndefined();

    // Display token exposes only public data.
    const disp = await rpc<{ players: Array<{ shownCards: unknown }>; me: { role: string } }>("get_display_snapshot", { p_display_token: hostSnap.control!.displayToken });
    expect(disp.me.role).toBe("display");
    for (const p of disp.players) expect(p.shownCards).toBeNull();
    expect(JSON.stringify(disp)).not.toContain(p1Cards[0]);
    await expectCode(rpc("get_display_snapshot", { p_display_token: "not-a-real-token-1234567890" }), "GAME_NOT_FOUND");

    // Players cannot run dealer or host actions.
    const controlCalls: Array<[string, Record<string, unknown>]> = [
      ["deal_flop", { p_game_id: gid }],
      ["start_hand", { p_game_id: gid }],
      ["end_hand", { p_game_id: gid }],
      ["set_seating_locked", { p_game_id: gid, p_locked: true }],
      ["dealer_mark_folded", { p_game_id: gid, p_player_id: t.players[1]!.playerId }],
      ["set_dealer_seat", { p_game_id: gid, p_seat: 1 }],
      ["replace_levels", { p_game_id: gid, p_levels: [] }],
      ["update_settings", { p_game_id: gid, p_patch: {} }],
      ["set_player_status", { p_game_id: gid, p_player_id: t.players[1]!.playerId, p_status: "eliminated" }],
      ["timer_action", { p_game_id: gid, p_action: "pause" }],
    ];
    for (const [fn, args] of controlCalls) {
      await expectCode(p1.call(fn, args), "NOT_AUTHORIZED");
    }
    const hostCalls: Array<[string, Record<string, unknown>]> = [
      ["end_game", { p_game_id: gid }],
      ["create_dealer_pairing", { p_game_id: gid }],
      ["transfer_host", { p_game_id: gid, p_target_device_id: t.host.deviceId }],
      ["revoke_dealer", { p_game_id: gid, p_target_device_id: t.host.deviceId }],
      ["disconnect_device", { p_game_id: gid, p_target_device_id: t.host.deviceId }],
    ];
    for (const [fn, args] of hostCalls) {
      await expectCode(p1.call(fn, args), "NOT_HOST");
    }

    // A player cannot fold or show for someone else: the functions act only on the caller's own hand.
    await p1.call("fold_hand", { p_game_id: gid });
    const p2Snap = await as(t.players[1]!.device).snapshot(gid);
    expect(p2Snap.me.hand?.status).toBe("in_hand");

    // Dealer-only device: control but no cards, cannot administer.
    const pairing = await host.call<{ pairingCode: string }>("create_dealer_pairing", { p_game_id: gid });
    const ipad = await mint("ipad");
    await as(ipad).call("pair_dealer", { p_pairing_code: pairing.pairingCode });
    const ipadSnap = await as(ipad).snapshot(gid);
    expect(ipadSnap.me.hand).toBeNull();
    expect(ipadSnap.me.playerId).toBeNull();
    expect(leak(ipadSnap)).not.toContain(p1Cards[0]);
    await expectCode(as(ipad).call("fold_hand", { p_game_id: gid }), "NOT_A_PLAYER");
    await expectCode(as(ipad).call("choose_seat", { p_game_id: gid, p_seat: 5 }), "NOT_A_PLAYER");
    await expectCode(as(ipad).call("end_game", { p_game_id: gid }), "NOT_HOST");

    // Burn cards and the deck never surface anywhere.
    const everything = JSON.stringify([hostSnap, p1Snap, ipadSnap, disp]);
    expect(everything).not.toContain("hand_decks");
    expect(everything).not.toContain("burn");

    await host.call("end_game", { p_game_id: gid });
    await expectCode(host.call("start_hand", { p_game_id: gid }), "GAME_NOT_ACTIVE");
  }, 90_000);

  it("seat races: only one player gets a contested seat", async () => {
    const t = await makeTable({ mode: "dealer", players: 0, seats: 4 });
    const a = await mint("a");
    const b = await mint("b");
    await as(a).call("join_game", { p_join_code: t.joinCode, p_display_name: "A" });
    await as(b).call("join_game", { p_join_code: t.joinCode, p_display_name: "B" });
    const results = await Promise.allSettled([as(a).call("choose_seat", { p_game_id: t.gameId, p_seat: 2 }), as(b).call("choose_seat", { p_game_id: t.gameId, p_seat: 2 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await as(t.host).call("end_game", { p_game_id: t.gameId });
  }, 30_000);

  it("duplicate street actions fired concurrently produce exactly one transition", async () => {
    const t = await makeTable({ mode: "dealer", players: 2 });
    const d = as(t.host);
    await d.call("start_game", { p_game_id: t.gameId });
    await d.call("start_hand", { p_game_id: t.gameId });
    const flops = await Promise.allSettled([1, 2, 3, 4].map(() => d.call("deal_flop", { p_game_id: t.gameId })));
    expect(flops.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await d.snapshot(t.gameId)).hand?.board).toHaveLength(3);
    const starts = await Promise.allSettled([1, 2, 3].map(() => d.call("start_hand", { p_game_id: t.gameId })));
    expect(starts.filter((r) => r.status === "fulfilled")).toHaveLength(0);
    await d.call("end_game", { p_game_id: t.gameId });
  }, 30_000);

  it("table full and seating locked are enforced on join", async () => {
    const t = await makeTable({ mode: "dealer", players: 2, seats: 2 });
    const extra = await mint("extra");
    await expectCode(as(extra).call("join_game", { p_join_code: t.joinCode, p_display_name: "Extra" }), "TABLE_FULL");
    await as(t.host).call("update_settings", { p_game_id: t.gameId, p_patch: { allowLateEntry: false } });
    await as(t.host).call("set_seating_locked", { p_game_id: t.gameId, p_locked: true });
    await expectCode(as(extra).call("join_game", { p_join_code: t.joinCode, p_display_name: "Extra" }), "SEATING_LOCKED");
    await as(t.host).call("end_game", { p_game_id: t.gameId });
    await expectCode(as(extra).call("join_game", { p_join_code: t.joinCode, p_display_name: "Extra" }), "GAME_NOT_FOUND");
  }, 30_000);
});
