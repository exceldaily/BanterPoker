import { describe, expect, it } from "vitest";
import { validateDeck } from "@/lib/cards";
import { dealOrder, positions } from "@/lib/positions";
import { as, expectCode, makeTable, mint, rpc } from "./client";

// Runs against the real shared database through the anon key. Every game it
// creates is ended so it never lingers as a joinable table.

describe("full game flow (dedicated dealer + 4 players)", () => {
  it("deals correctly, keeps cards private, progresses streets exactly once, rotates the button", async () => {
    const t = await makeTable({ mode: "dealer", players: 4 });
    const dealer = as(t.host);
    const gid = t.gameId;

    // Dealer device is not a player and does not count.
    const lobby = await dealer.snapshot(gid);
    expect(lobby.me.role).toBe("dealer");
    expect(lobby.me.playerId).toBeNull();
    expect(lobby.players).toHaveLength(4);
    expect(lobby.control?.joinCode).toBe(t.joinCode);

    await dealer.call("start_game", { p_game_id: gid });
    await expectCode(dealer.call("deal_flop", { p_game_id: gid }), "NO_HAND");

    // Hand 1
    const h1 = await dealer.call<{ handNumber: number }>("start_hand", { p_game_id: gid });
    expect(h1.handNumber).toBe(1);
    await expectCode(dealer.call("start_hand", { p_game_id: gid }), "HAND_IN_PROGRESS");

    const ds = await dealer.snapshot(gid);
    expect(ds.hand?.state).toBe("pre_flop");
    expect(ds.hand?.playersDealtIn).toBe(4);
    expect(ds.me.hand).toBeNull(); // dealer sees no cards
    for (const p of ds.players) expect(p.shownCards).toBeNull();

    // Positions match the reference implementation.
    const seated = ds.players.map((p) => ({ seat: p.seat!, status: p.status as "active" }));
    const order = dealOrder(seated, ds.hand!.dealerSeat);
    const pos = positions(order, ds.hand!.dealerSeat);
    expect(ds.hand!.smallBlindSeat).toBe(pos.smallBlind);
    expect(ds.hand!.bigBlindSeat).toBe(pos.bigBlind);
    expect(ds.game.dealerSeat).toBe(ds.hand!.dealerSeat);

    // Each player sees exactly their own two cards; all eight are distinct.
    const seen = new Set<string>();
    for (const p of t.players) {
      const s = await as(p.device).snapshot(gid);
      expect(s.me.hand?.status).toBe("in_hand");
      expect(s.me.hand?.cards).toHaveLength(2);
      for (const c of s.me.hand!.cards!) {
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
      // reload does not reshuffle
      const again = await as(p.device).snapshot(gid);
      expect(again.me.hand?.cards).toEqual(s.me.hand?.cards);
      // and nobody else's cards are present anywhere in the payload
      expect(JSON.stringify(s.players)).not.toMatch(/"shownCards":\["/);
    }

    // Players cannot deal.
    await expectCode(as(t.players[0]!.device).call("deal_flop", { p_game_id: gid }), "NOT_AUTHORIZED");

    // Flop exactly once; duplicates rejected; board distinct from hole cards.
    const flop = await dealer.call<{ board: string[] }>("deal_flop", { p_game_id: gid });
    expect(flop.board).toHaveLength(3);
    await expectCode(dealer.call("deal_flop", { p_game_id: gid }), "INVALID_TRANSITION");
    await expectCode(dealer.call("deal_river", { p_game_id: gid }), "INVALID_TRANSITION");
    for (const c of flop.board) {
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }

    // Fold: player 2 folds, cards become inaccessible, counts update.
    await as(t.players[1]!.device).call("fold_hand", { p_game_id: gid });
    await as(t.players[1]!.device).call("fold_hand", { p_game_id: gid }); // idempotent
    const folded = await as(t.players[1]!.device).snapshot(gid);
    expect(folded.me.hand?.status).toBe("folded");
    expect(folded.me.hand?.cards).toBeNull();
    // Mid-hand nobody can show, folded or not.
    await expectCode(as(t.players[1]!.device).call("show_hand", { p_game_id: gid }), "HAND_IN_PROGRESS");
    const afterFold = await dealer.snapshot(gid);
    expect(afterFold.hand?.playersFolded).toBe(1);
    expect(afterFold.hand?.playersRemaining).toBe(3);
    expect(afterFold.players.find((p) => p.id === t.players[1]!.playerId)?.handStatus).toBe("folded");

    // Dealer override fold for player 3.
    await dealer.call("dealer_mark_folded", { p_game_id: gid, p_player_id: t.players[2]!.playerId });
    // Only the player can fold themselves normally: player 1 cannot fold player 4.
    // (There is no such function; the dealer path is the only override and it logs.)

    const turn = await dealer.call<{ board: string[] }>("deal_turn", { p_game_id: gid });
    expect(turn.board).toHaveLength(4);
    const river = await dealer.call<{ board: string[] }>("deal_river", { p_game_id: gid });
    expect(river.board).toHaveLength(5);
    expect(new Set(river.board).size).toBe(5);
    for (const c of river.board.slice(3)) expect(seen.has(c)).toBe(false);

    // Showing is refused while the hand is live, even on the river.
    await expectCode(as(t.players[0]!.device).call("show_hand", { p_game_id: gid }), "HAND_IN_PROGRESS");
    expect((await dealer.snapshot(gid)).players.every((p) => p.shownCards === null)).toBe(true);

    // End hand, button rotates to next active seat clockwise.
    const ended = await dealer.call<{ nextDealerSeat: number }>("end_hand", { p_game_id: gid });
    await expectCode(dealer.call("end_hand", { p_game_id: gid }), "INVALID_TRANSITION");
    const afterEnd = await dealer.snapshot(gid);
    expect(afterEnd.hand?.state).toBe("complete");
    expect(afterEnd.game.dealerSeat).toBe(ended.nextDealerSeat);
    expect(ended.nextDealerSeat).not.toBe(ds.hand!.dealerSeat);

    // After END HAND a player may show; cards appear publicly for everyone, including the dealer.
    // A folded player's cards stay private for good.
    await expectCode(as(t.players[1]!.device).call("show_hand", { p_game_id: gid }), "ALREADY_FOLDED");
    await as(t.players[0]!.device).call("show_hand", { p_game_id: gid });
    const mine = await as(t.players[0]!.device).snapshot(gid);
    const pub = await dealer.snapshot(gid);
    const shownRow = pub.players.find((p) => p.id === t.players[0]!.playerId)!;
    expect(shownRow.handStatus).toBe("shown");
    expect(shownRow.shownCards).toEqual(mine.me.hand?.cards);
    // Player 4 keeps private until they choose otherwise.
    expect(pub.players.find((p) => p.id === t.players[3]!.playerId)?.shownCards).toBeNull();
    await as(t.players[3]!.device).call("show_hand", { p_game_id: gid });
    const afterShow = await dealer.snapshot(gid);
    expect(afterShow.players.find((p) => p.id === t.players[3]!.playerId)?.shownCards).toHaveLength(2);

    // Per-game photo: set, visible to the table, wiped when the game ends.
    const avatar = `data:image/jpeg;base64,${Buffer.from("not-really-a-jpeg-but-shaped-like-one").toString("base64")}`;
    await as(t.players[0]!.device).call("set_avatar", { p_game_id: gid, p_avatar: avatar });
    expect((await dealer.snapshot(gid)).players.find((p) => p.id === t.players[0]!.playerId)?.avatar).toBe(avatar);
    await expectCode(as(t.players[0]!.device).call("set_avatar", { p_game_id: gid, p_avatar: "data:image/png;base64,AAAA" }), "AVATAR_INVALID");
    await expectCode(as(t.host).call("set_avatar", { p_game_id: gid, p_avatar: avatar }), "NOT_A_PLAYER");

    // Hand 2: new shuffle, fold state reset, previous cards gone.
    const h2 = await dealer.call<{ handNumber: number }>("start_hand", { p_game_id: gid });
    expect(h2.handNumber).toBe(2);
    const p2 = await as(t.players[1]!.device).snapshot(gid);
    expect(p2.me.hand?.status).toBe("in_hand");
    expect(p2.me.hand?.cards).toHaveLength(2);
    expect(p2.hand?.dealerSeat).toBe(ended.nextDealerSeat);
    const allHand2: string[] = [];
    for (const p of t.players) allHand2.push(...(await as(p.device).snapshot(gid)).me.hand!.cards!);
    expect(new Set(allHand2).size).toBe(8);
    expect(allHand2.join(",")).not.toBe([...seen].slice(0, 8).join(","));

    // Eliminate player 2 mid-hand does not affect this hand; next hand skips them and the button skips them too.
    await dealer.call("set_player_status", { p_game_id: gid, p_player_id: t.players[1]!.playerId, p_status: "eliminated" });
    await dealer.call("end_hand", { p_game_id: gid });
    await dealer.call("start_hand", { p_game_id: gid });
    const h3 = await dealer.snapshot(gid);
    expect(h3.hand?.playersDealtIn).toBe(3);
    expect(h3.hand?.dealerSeat).not.toBe(t.players[1]!.seat);
    await expectCode(as(t.players[1]!.device).call("fold_hand", { p_game_id: gid }), "NOT_IN_HAND");
    expect((await as(t.players[1]!.device).snapshot(gid)).me.hand).toBeNull();

    // Restore + sitting out.
    await dealer.call("end_hand", { p_game_id: gid });
    await dealer.call("set_player_status", { p_game_id: gid, p_player_id: t.players[1]!.playerId, p_status: "active" });
    await dealer.call("set_player_status", { p_game_id: gid, p_player_id: t.players[2]!.playerId, p_status: "sitting_out" });
    await dealer.call("start_hand", { p_game_id: gid });
    const h4 = await dealer.snapshot(gid);
    expect(h4.hand?.playersDealtIn).toBe(3);
    expect((await as(t.players[2]!.device).snapshot(gid)).me.hand).toBeNull();

    // End game (host only) with a winner.
    await expectCode(as(t.players[0]!.device).call("end_game", { p_game_id: gid }), "NOT_HOST");
    await dealer.call("end_game", { p_game_id: gid, p_winner_player_id: t.players[0]!.playerId });
    const done = await dealer.snapshot(gid);
    expect(done.game.status).toBe("complete");
    expect(done.game.winnerPlayerId).toBe(t.players[0]!.playerId);
    expect(done.game.handCount).toBe(4);
    expect(done.players.every((p) => p.avatar === null)).toBe(true);
  }, 120_000);
});

describe("heads-up and player-host", () => {
  it("button posts the small blind heads-up, host gets cards but no other hands", async () => {
    const t = await makeTable({ mode: "play_host", players: 1 });
    const host = as(t.host);
    await host.call("start_game", { p_game_id: t.gameId });
    await host.call("start_hand", { p_game_id: t.gameId });
    const s = await host.snapshot(t.gameId);
    expect(s.hand?.playersDealtIn).toBe(2);
    expect(s.hand?.smallBlindSeat).toBe(s.hand?.dealerSeat);
    expect(s.hand?.bigBlindSeat).not.toBe(s.hand?.dealerSeat);
    expect(s.me.hand?.cards).toHaveLength(2);
    expect(s.me.isHost).toBe(true);
    // Host's view contains only their own cards; the other player's row is hidden.
    const other = s.players.find((p) => p.id !== s.me.playerId)!;
    expect(other.shownCards).toBeNull();
    // Next hand: button swaps.
    await host.call("end_hand", { p_game_id: t.gameId });
    await host.call("start_hand", { p_game_id: t.gameId });
    const s2 = await host.snapshot(t.gameId);
    expect(s2.hand?.dealerSeat).not.toBe(s.hand?.dealerSeat);
    expect(s2.hand?.smallBlindSeat).toBe(s2.hand?.dealerSeat);
    await host.call("end_game", { p_game_id: t.gameId });
  }, 60_000);
});

describe("dealer device pairing, transfer host, late entry, reclaim", () => {
  it("works end to end", async () => {
    const t = await makeTable({ mode: "play_host", players: 2, seats: 6 });
    const host = as(t.host);
    const ipad = await mint("ipad");
    // Public join code must not grant dealer control.
    await expectCode(as(ipad).call("pair_dealer", { p_pairing_code: t.joinCode }), "PAIRING_INVALID");
    // Only host can create pairing codes.
    await expectCode(as(t.players[0]!.device).call("create_dealer_pairing", { p_game_id: t.gameId }), "NOT_HOST");
    const pairing = await host.call<{ pairingCode: string }>("create_dealer_pairing", { p_game_id: t.gameId });
    await as(ipad).call("pair_dealer", { p_pairing_code: pairing.pairingCode, p_device_label: "Table iPad" });
    // Code is single use.
    await expectCode(as(await mint("other")).call("pair_dealer", { p_pairing_code: pairing.pairingCode }), "PAIRING_INVALID");

    const ipadView = await as(ipad).snapshot(t.gameId);
    expect(ipadView.me.role).toBe("dealer");
    expect(ipadView.me.canControl).toBe(true);
    expect(ipadView.me.isHost).toBe(false);
    expect(ipadView.players).toHaveLength(3); // dealer not a player

    await as(ipad).call("start_game", { p_game_id: t.gameId });
    await as(ipad).call("start_hand", { p_game_id: t.gameId });
    const during = await as(ipad).snapshot(t.gameId);
    expect(during.me.hand).toBeNull();
    expect(during.hand?.playersDealtIn).toBe(3);
    // Two control devices: only one flop.
    const results = await Promise.allSettled([host.call("deal_flop", { p_game_id: t.gameId }), as(ipad).call("deal_flop", { p_game_id: t.gameId })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await host.snapshot(t.gameId)).hand?.board).toHaveLength(3);

    // Late entry: join after lock -> pending, choose seat, approve.
    const late = await mint("late");
    const joined = await as(late).call<{ playerId: string }>("join_game", { p_join_code: t.joinCode, p_display_name: "Late Larry" });
    expect((await as(late).snapshot(t.gameId)).me.status).toBe("pending");
    await as(late).call("choose_seat", { p_game_id: t.gameId, p_seat: 6 });
    await expectCode(as(late).call("choose_seat", { p_game_id: t.gameId, p_seat: 1 }), "SEAT_TAKEN");
    await as(ipad).call("set_player_status", { p_game_id: t.gameId, p_player_id: joined.playerId, p_status: "active" });
    await as(ipad).call("end_hand", { p_game_id: t.gameId });
    await as(ipad).call("start_hand", { p_game_id: t.gameId });
    expect((await as(late).snapshot(t.gameId)).me.hand?.cards).toHaveLength(2);

    // Reclaim a seat from a new phone after the host disconnects the old one.
    const newPhone = await mint("new phone");
    await expectCode(as(newPhone).call("claim_player", { p_join_code: t.joinCode, p_player_id: t.players[0]!.playerId }), "CLAIM_NOT_AVAILABLE");
    await host.call("disconnect_device", { p_game_id: t.gameId, p_target_device_id: t.players[0]!.device.deviceId });
    await expectCode(as(t.players[0]!.device).snapshot(t.gameId), "NOT_IN_GAME");
    await as(newPhone).call("claim_player", { p_join_code: t.joinCode, p_player_id: t.players[0]!.playerId });
    const reclaimed = await as(newPhone).snapshot(t.gameId);
    expect(reclaimed.me.playerId).toBe(t.players[0]!.playerId);
    expect(reclaimed.me.hand?.cards).toHaveLength(2);

    // Transfer host to player 2, revoke the iPad.
    await expectCode(as(ipad).call("transfer_host", { p_game_id: t.gameId, p_target_device_id: t.players[1]!.device.deviceId }), "NOT_HOST");
    await host.call("transfer_host", { p_game_id: t.gameId, p_target_device_id: t.players[1]!.device.deviceId });
    const oldHost = await host.snapshot(t.gameId);
    expect(oldHost.me.isHost).toBe(false);
    expect(oldHost.me.canControl).toBe(false);
    expect(oldHost.me.hand?.cards).toHaveLength(2); // still a player with a private hand
    const newHost = as(t.players[1]!.device);
    expect((await newHost.snapshot(t.gameId)).me.isHost).toBe(true);
    await newHost.call("revoke_dealer", { p_game_id: t.gameId, p_target_device_id: ipad.deviceId });
    await expectCode(as(ipad).call("deal_flop", { p_game_id: t.gameId }), "NOT_IN_GAME");
    await newHost.call("end_game", { p_game_id: t.gameId });
  }, 120_000);
});

describe("tournament clock", () => {
  it("pauses, resumes, adjusts, advances through breaks and honours advance-after-hand", async () => {
    const t = await makeTable({ mode: "dealer", players: 2, advanceAfterHand: true });
    const d = as(t.host);
    const gid = t.gameId;
    await d.call("start_game", { p_game_id: gid });
    let s = await d.snapshot(gid);
    const [l1, brk, l2] = s.tournament.levels;
    expect(s.tournament.currentLevelId).toBe(l1!.id);
    expect(s.tournament.timerStatus).toBe("running");
    expect(s.tournament.remainingSeconds).toBeGreaterThan(55);

    const paused = await d.call<{ timerStatus: string; remainingSeconds: number }>("timer_action", { p_game_id: gid, p_action: "pause" });
    expect(paused.timerStatus).toBe("paused");
    const r1 = paused.remainingSeconds;
    await new Promise((r) => setTimeout(r, 1200));
    expect((await d.snapshot(gid)).tournament.remainingSeconds).toBe(r1);
    const resumed = await d.call<{ timerStatus: string }>("timer_action", { p_game_id: gid, p_action: "resume" });
    expect(resumed.timerStatus).toBe("running");
    const plus = await d.call<{ remainingSeconds: number }>("timer_action", { p_game_id: gid, p_action: "add_seconds", p_arg: 300 });
    expect(plus.remainingSeconds).toBeGreaterThan(300);
    await expectCode(d.call("timer_action", { p_game_id: gid, p_action: "add_seconds", p_arg: 99999 }), "ARG_INVALID");
    await expectCode(as(t.players[0]!.device).call("timer_action", { p_game_id: gid, p_action: "pause" }), "NOT_AUTHORIZED");

    // Expire level 1 while NO hand is open: auto-advances into the break.
    // Shift just past the end so the 60s break has not itself expired (the
    // server cascades expired levels by wall clock, which is correct).
    const exp = await d.call<{ currentLevelId: string; timerStatus: string }>("timer_action", { p_game_id: gid, p_action: "add_seconds", p_arg: -(plus.remainingSeconds + 20) });
    expect(exp.currentLevelId).toBe(brk!.id);
    expect(exp.timerStatus).toBe("running");
    expect((await d.snapshot(gid)).tournament.remainingSeconds).toBeLessThanOrEqual(40);

    // Manual next into level 2, then expire during a hand: pending advance until END HAND.
    await d.call("timer_action", { p_game_id: gid, p_action: "next" });
    await d.call("start_hand", { p_game_id: gid });
    const mid = await d.call<{ currentLevelId: string; timerStatus: string }>("timer_action", { p_game_id: gid, p_action: "add_seconds", p_arg: -3600 });
    expect(mid.currentLevelId).toBe(l2!.id);
    expect(mid.timerStatus).toBe("expired");
    s = await d.snapshot(gid);
    expect(s.tournament.pendingAdvance).toBe(true);
    // Any member can sync; nothing changes while the hand is open.
    await as(t.players[0]!.device).call("sync_timer", { p_game_id: gid });
    expect((await d.snapshot(gid)).tournament.currentLevelId).toBe(l2!.id);
    await d.call("end_hand", { p_game_id: gid });
    s = await d.snapshot(gid);
    expect(s.tournament.currentLevelId).toBe(s.tournament.levels[3]!.id);
    expect(s.tournament.timerStatus).toBe("running");
    expect(s.tournament.pendingAdvance).toBe(false);

    // Previous level, reset, last level expiry with no next -> expired.
    await d.call("timer_action", { p_game_id: gid, p_action: "prev" });
    expect((await d.snapshot(gid)).tournament.currentLevelId).toBe(l2!.id);
    await d.call("timer_action", { p_game_id: gid, p_action: "reset" });
    expect((await d.snapshot(gid)).tournament.remainingSeconds).toBeGreaterThan(1190);
    await d.call("timer_action", { p_game_id: gid, p_action: "next" });
    const last = await d.call<{ timerStatus: string }>("timer_action", { p_game_id: gid, p_action: "add_seconds", p_arg: -3600 });
    expect(last.timerStatus).toBe("expired");
    await expectCode(d.call("timer_action", { p_game_id: gid, p_action: "next" }), "NO_NEXT_LEVEL");

    // Structure edits are allowed by default (home games double blinds mid-session)
    // but the host can lock them, and the lock is enforced server-side.
    await d.call("update_settings", { p_game_id: gid, p_patch: { allowStructureEdits: false } });
    await expectCode(d.call("replace_levels", { p_game_id: gid, p_levels: [{ smallBlind: 1, bigBlind: 2, durationSeconds: 600 }] }), "STRUCTURE_LOCKED");
    await d.call("update_settings", { p_game_id: gid, p_patch: { allowStructureEdits: true } });
    await d.call("replace_levels", { p_game_id: gid, p_levels: [{ smallBlind: 1, bigBlind: 2, durationSeconds: 600 }, { smallBlind: 2, bigBlind: 4, durationSeconds: 600 }] });
    expect((await d.snapshot(gid)).tournament.levels).toHaveLength(2);
    await d.call("end_game", { p_game_id: gid });
  }, 90_000);

  it("casual mode has no clock but shows stakes", async () => {
    const t = await makeTable({ mode: "dealer", players: 2, timerMode: "casual" });
    const d = as(t.host);
    await d.call("start_game", { p_game_id: t.gameId });
    await expectCode(d.call("timer_action", { p_game_id: t.gameId, p_action: "pause" }), "NO_TIMER");
    await d.call("update_settings", { p_game_id: t.gameId, p_patch: { casualSmallBlind: 1, casualBigBlind: 2, casualAnte: 1, casualAnteType: "standard" } });
    await d.call("end_game", { p_game_id: t.gameId });
  }, 30_000);
});

describe("shuffle fairness over many hands", () => {
  it("every hand is a fresh, valid permutation with no overlap between players and board", async () => {
    const t = await makeTable({ mode: "dealer", players: 12, seats: 12 });
    const d = as(t.host);
    await d.call("start_game", { p_game_id: t.gameId });
    const firstCards: string[] = [];
    for (let hand = 0; hand < 5; hand++) {
      await d.call("start_hand", { p_game_id: t.gameId });
      const cards: string[] = [];
      for (const p of t.players) cards.push(...(await as(p.device).snapshot(t.gameId)).me.hand!.cards!);
      await d.call("deal_flop", { p_game_id: t.gameId });
      await d.call("deal_turn", { p_game_id: t.gameId });
      const river = await d.call<{ board: string[] }>("deal_river", { p_game_id: t.gameId });
      cards.push(...river.board);
      expect(cards).toHaveLength(29); // 24 hole + 5 board (3 burns hidden)
      expect(new Set(cards).size).toBe(29);
      // subset of a valid deck
      const check = validateDeck([...cards, ...validateDeckFiller(cards)]);
      expect(check.ok).toBe(true);
      firstCards.push(cards[0]!);
      await d.call("end_hand", { p_game_id: t.gameId });
    }
    expect(new Set(firstCards).size).toBeGreaterThan(1);
    await d.call("end_game", { p_game_id: t.gameId });
  }, 180_000);
});

/** Fills the remaining cards so validateDeck can prove `cards` are all distinct real cards. */
function validateDeckFiller(cards: string[]): string[] {
  const all = new Set(["S", "H", "D", "C"].flatMap((s) => ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"].map((r) => r + s)));
  for (const c of cards) all.delete(c);
  return [...all];
}

describe("rate limits", () => {
  it("throttles repeated lookups from one device", async () => {
    const d = await mint("spammer");
    let limited = false;
    for (let i = 0; i < 40; i++) {
      try {
        await rpc("lookup_game", { p_device_id: d.deviceId, p_secret: d.secret, p_join_code: "ZZZZZZ" });
      } catch (err) {
        if ((err as { code?: string }).code === "RATE_LIMITED") {
          limited = true;
          break;
        }
      }
    }
    expect(limited).toBe(true);
  }, 60_000);
});
