// Stable error codes raised by the database functions (banterpoker.fail) and
// the friendly copy shown for each. Raw database errors never reach the UI.

export const ERROR_COPY: Record<string, string> = {
  DEVICE_INVALID: "This device needs to reconnect. Refresh and try again.",
  RATE_LIMITED: "Slow down a second and try again.",
  GAME_NOT_FOUND: "No table with that code. Double-check it with your host.",
  GAME_ENDED: "That game has already ended.",
  GAME_NOT_ACTIVE: "The game has not started yet.",
  GAME_ALREADY_STARTED: "The game is already underway.",
  NOT_IN_GAME: "You are not part of this table anymore.",
  NOT_AUTHORIZED: "Only the table host or a dealer device can do that.",
  NOT_HOST: "Only the table host can do that.",
  NOT_A_PLAYER: "Dealer devices do not take seats.",
  PLAYER_INACTIVE: "That player is out of the game.",
  NAME_REQUIRED: "Enter a name first.",
  SEAT_INVALID: "That seat does not exist at this table.",
  SEAT_TAKEN: "Someone grabbed that seat a moment ago. Pick another one.",
  SEAT_REQUIRED: "Give this player a seat first.",
  SEAT_NOT_ACTIVE: "The button can only sit with an active player.",
  SEATING_LOCKED: "Seating is locked. Ask the host to let you in.",
  TABLE_FULL: "This table is full.",
  NOT_ENOUGH_PLAYERS: "You need at least two seated, active players.",
  HAND_IN_PROGRESS: "Finish the current hand first.",
  NO_HAND: "There is no hand in progress.",
  NOT_IN_HAND: "You were not dealt into this hand.",
  INVALID_TRANSITION: "That step already happened. The table is up to date.",
  ALREADY_SHOWN: "You already showed this hand.",
  ALREADY_FOLDED: "You folded this hand.",
  NO_TIMER: "This table is not running a tournament clock.",
  NO_NEXT_LEVEL: "That was the last level in the structure.",
  NO_PREV_LEVEL: "You are already on the first level.",
  LEVELS_REQUIRED: "Add at least one blind level.",
  LEVELS_INVALID: "That blind structure is not valid.",
  STRUCTURE_LOCKED: "Mid-game structure edits are turned off for this table.",
  PAIRING_INVALID: "That dealer code is wrong or has expired.",
  DEVICE_NOT_FOUND: "That device is no longer connected.",
  CANNOT_REVOKE_HOST: "The host device cannot be removed.",
  HOST_CANNOT_LEAVE: "Transfer host control before leaving.",
  CLAIM_NOT_AVAILABLE: "That seat cannot be reclaimed right now. Ask the host to disconnect the old phone.",
  ALREADY_MEMBER: "This device is already at the table.",
  PLAYER_NOT_FOUND: "That player is not at this table.",
  STATUS_INVALID: "Unknown player status.",
  MODE_INVALID: "Pick how this device will be used.",
  SEATS_INVALID: "Tables seat between 2 and 12 players.",
  ARG_INVALID: "That value is out of range.",
  ACTION_INVALID: "Unknown clock action.",
  CODE_COLLISION: "Could not generate a table code. Try again.",
  OFFLINE: "You are offline. Reconnect to keep playing.",
  NETWORK: "Could not reach the table. Check your connection.",
  UNKNOWN: "Something went wrong. Try again.",
};

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? ERROR_COPY[code] ?? ERROR_COPY.UNKNOWN);
    this.name = "ApiError";
    this.code = code;
  }
}

export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiError) return ERROR_COPY[err.code] ?? err.message;
  if (err instanceof Error && err.message in ERROR_COPY) return ERROR_COPY[err.message]!;
  return ERROR_COPY.UNKNOWN!;
}

/** Maps a PostgREST error body to an ApiError without leaking SQL detail. */
export function errorFromPostgrest(body: unknown): ApiError {
  if (body && typeof body === "object" && "message" in body) {
    const msg = String((body as { message: unknown }).message);
    if (/^[A-Z_]{3,40}$/.test(msg) && msg in ERROR_COPY) return new ApiError(msg);
    if (/^[A-Z_]{3,40}$/.test(msg)) return new ApiError(msg, ERROR_COPY.UNKNOWN);
  }
  return new ApiError("UNKNOWN");
}
