/**
 * Generated beeps for the Caja alert (Web Audio, no asset files). Browser-only, but defensive:
 * every entry point swallows errors, because a missing/blocked AudioContext must never break the
 * screen. ONE oscillator per beep (so one `start()`): its frequency steps up for the two tones.
 */

type AudioContextCtor = new () => AudioContext;
/** `ready` is the counter TV's "ding" when an order number moves to "¡Listo!". */
export type BeepKind = "new" | "reminder" | "confirm" | "ready";

const SHAPES: Record<BeepKind, { f1: number; f2: number; tone: number; gain: number }> = {
  new: { f1: 880, f2: 1175, tone: 0.18, gain: 0.35 },
  reminder: { f1: 660, f2: 660, tone: 0.14, gain: 0.15 },
  confirm: { f1: 740, f2: 988, tone: 0.1, gain: 0.2 },
  ready: { f1: 1319, f2: 1047, tone: 0.22, gain: 0.4 },
};

export type Beeper = {
  supported: boolean;
  /** Creates/resumes the context. Call it from a user gesture. Resolves true when it can play. */
  unlock(): Promise<boolean>;
  /** True when a beep would be audible right now. */
  ready(): boolean;
  play(kind: BeepKind): void;
};

export function createBeeper(win: Window | undefined = typeof window === "undefined" ? undefined : window): Beeper {
  const Ctor = win
    ? ((win as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }).AudioContext ??
      (win as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext)
    : undefined;
  let ctx: AudioContext | null = null;

  const get = (): AudioContext | null => {
    if (!Ctor) return null;
    try {
      ctx ??= new Ctor();
      return ctx;
    } catch {
      return null;
    }
  };

  return {
    supported: Boolean(Ctor),
    async unlock() {
      const c = get();
      if (!c) return false;
      try {
        if (c.state === "suspended") await c.resume();
        return c.state === "running";
      } catch {
        return false;
      }
    },
    ready: () => ctx !== null && ctx.state === "running",
    play(kind) {
      const c = ctx;
      if (!c || c.state !== "running") return;
      try {
        const { f1, f2, tone, gain } = SHAPES[kind];
        const t = c.currentTime;
        const osc = c.createOscillator();
        const amp = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f1, t);
        osc.frequency.setValueAtTime(f2, t + tone);
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.linearRampToValueAtTime(gain, t + 0.02);
        amp.gain.setValueAtTime(gain, t + tone * 2 - 0.04);
        amp.gain.linearRampToValueAtTime(0.0001, t + tone * 2);
        osc.connect(amp);
        amp.connect(c.destination);
        osc.start(t);
        osc.stop(t + tone * 2 + 0.02);
      } catch {
        // never throw from a beep
      }
    },
  };
}
