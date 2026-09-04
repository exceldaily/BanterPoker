// Shape of the snapshots returned by the database functions. Kept in sync with
// banterpoker.public_snapshot / get_game_snapshot in supabase/migrations/0002.

export type GameStatus = "lobby" | "active" | "complete";
export type PlayerStatus = "active" | "sitting_out" | "eliminated" | "pending" | "removed";
export type HandState = "pre_flop" | "flop" | "turn" | "river" | "complete";
export type HandPlayerStatus = "in_hand" | "folded" | "shown" | "mucked";
export type LevelType = "play" | "break";
export type AnteType = "none" | "standard" | "big_blind";
export type TimerMode = "tournament" | "casual" | "none";
export type TimerStatus = "idle" | "running" | "paused" | "expired";
export type DeviceRole = "player" | "dealer" | "display";

export interface SnapshotGame {
  id: string;
  tableName: string;
  status: GameStatus;
  maxSeats: number;
  seatingLocked: boolean;
  allowLateEntry: boolean;
  autoAdvanceLevels: boolean;
  advanceAfterHand: boolean;
  allowStructureEdits: boolean;
  soundsEnabled: boolean;
  hapticsEnabled: boolean;
  timerAlertsEnabled: boolean;
  timerMode: TimerMode;
  casual: { smallBlind: number | null; bigBlind: number | null; ante: number | null; anteType: AnteType };
  handCount: number;
  dealerSeat: number | null;
  winnerPlayerId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  version: number;
}

export interface SnapshotPlayer {
  id: string;
  name: string;
  seat: number | null;
  status: PlayerStatus;
  isHost: boolean;
  hasDevice: boolean;
  lastSeenAt: string | null;
  handStatus: HandPlayerStatus | null;
  shownCards: [string, string] | null;
}

export interface SnapshotHand {
  id: string;
  number: number;
  state: HandState;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  board: string[];
  playersDealtIn: number;
  playersRemaining: number;
  playersFolded: number;
  createdAt: string;
  completedAt: string | null;
}

export interface SnapshotLevel {
  id: string;
  sortOrder: number;
  type: LevelType;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  anteType: AnteType;
  durationSeconds: number;
}

export interface SnapshotTournament {
  levels: SnapshotLevel[];
  currentLevelId: string | null;
  timerStatus: TimerStatus;
  levelStartedAt: string | null;
  pausedAt: string | null;
  remainingAtPause: number | null;
  remainingSeconds: number;
  pendingAdvance: boolean;
  serverNow: string;
}

export interface SnapshotMe {
  deviceId?: string;
  role: DeviceRole;
  canControl?: boolean;
  isHost?: boolean;
  playerId?: string | null;
  name?: string | null;
  seat?: number | null;
  status?: PlayerStatus | null;
  hand?: { status: HandPlayerStatus; cards: [string, string] | null } | null;
}

export interface SnapshotDevice {
  id: string;
  deviceId: string;
  role: "player" | "dealer";
  canControl: boolean;
  isHost: boolean;
  playerId: string | null;
  label: string | null;
  lastSeenAt: string;
}

export interface SnapshotControl {
  joinCode: string;
  displayToken: string;
  devices: SnapshotDevice[];
  dealerPairingCode: string | null;
  dealerPairingExpiresAt: string | null;
}

export interface PublicSnapshot {
  game: SnapshotGame;
  players: SnapshotPlayer[];
  hand: SnapshotHand | null;
  tournament: SnapshotTournament;
  reason?: string;
}

export interface GameSnapshot extends PublicSnapshot {
  me: SnapshotMe;
  control?: SnapshotControl;
}

export interface LevelInput {
  type: LevelType;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  anteType: AnteType;
  durationSeconds: number;
}

export interface CreateGameConfig {
  tableName: string;
  maxSeats: number;
  mode: "play_host" | "dealer";
  displayName?: string;
  timerMode: TimerMode;
  levels?: LevelInput[];
  casual?: { smallBlind: number; bigBlind: number; ante: number; anteType: AnteType };
  allowLateEntry: boolean;
  autoAdvanceLevels: boolean;
  advanceAfterHand: boolean;
  allowStructureEdits?: boolean;
  soundsEnabled: boolean;
  hapticsEnabled: boolean;
  timerAlertsEnabled: boolean;
  deviceLabel?: string;
}

export interface GameEvent {
  id: number;
  type: string;
  handId: string | null;
  payload: Record<string, unknown>;
  at: string;
}
