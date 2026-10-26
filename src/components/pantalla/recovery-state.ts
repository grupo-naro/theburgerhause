/**
 * How many times in a row the TV's error screen has tried to recover. Module state on purpose: it survives the error
 * boundary re-mounting after a failed retry; the board resets it when it renders again, a full reload starts over.
 */
export const recoveryState = { attempts: 0 };
