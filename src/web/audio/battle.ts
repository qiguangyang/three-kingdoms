// Minimal Web Audio sound effects for the battle animation. No assets:
// every sound is synthesized with OscillatorNode + an envelope so the
// bundle stays tiny and there's nothing to load before the first beat.
//
// The AudioContext is lazily created on first use because browsers
// require a user gesture to start audio. By the time any of these
// functions are called we're inside a click/keypress handler chain
// (the player triggered an attack), so resume() is safe.

let ctx: AudioContext | null = null;
const STORAGE_KEY = 'tk-audio-muted';

export function isMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Ignore quota / privacy errors — audio stays usable in-session.
  }
}

export function toggleMuted(): boolean {
  const next = !isMuted();
  setMuted(next);
  return next;
}

function ensureCtx(): AudioContext | null {
  if (isMuted()) return null;
  if (ctx === null) {
    try {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
  }
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume();
  }
  return ctx;
}

interface ToneOpts {
  freq: number;
  type?: OscillatorType;
  durationMs: number;
  attackMs?: number;
  releaseMs?: number;
  peakGain?: number;
  // Pitch glide: target frequency at the end of the tone.
  glideTo?: number;
}

function playTone(opts: ToneOpts): void {
  const c = ensureCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, opts.glideTo),
      now + opts.durationMs / 1000,
    );
  }
  const attack = (opts.attackMs ?? 6) / 1000;
  const release = (opts.releaseMs ?? 80) / 1000;
  const peak = opts.peakGain ?? 0.12;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.setValueAtTime(peak, now + Math.max(attack, opts.durationMs / 1000 - release));
  gain.gain.linearRampToValueAtTime(0, now + opts.durationMs / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + opts.durationMs / 1000 + 0.02);
}

// Low rolling drum: short cluster of low tones for the march phase.
export function playMarch(): void {
  if (isMuted()) return;
  const beats = [0, 90, 200, 320];
  for (const offsetMs of beats) {
    setTimeout(() => {
      playTone({
        freq: 110,
        type: 'sine',
        durationMs: 120,
        peakGain: 0.18,
        attackMs: 5,
        releaseMs: 70,
        glideTo: 70,
      });
    }, offsetMs);
  }
}

// Sharp clash for the engage transition. Stacked square + saw for grit.
export function playClash(): void {
  if (isMuted()) return;
  playTone({
    freq: 880,
    type: 'square',
    durationMs: 180,
    peakGain: 0.1,
    attackMs: 2,
    releaseMs: 140,
    glideTo: 220,
  });
  playTone({
    freq: 440,
    type: 'sawtooth',
    durationMs: 220,
    peakGain: 0.08,
    attackMs: 2,
    releaseMs: 180,
    glideTo: 130,
  });
}

// Subtle metronome tick for each in-fiction day. Kept low-volume so it
// doesn't fatigue across a 30-day siege.
export function playDayTick(): void {
  playTone({
    freq: 1600,
    type: 'sine',
    durationMs: 50,
    peakGain: 0.04,
    attackMs: 2,
    releaseMs: 40,
  });
}

// Victory gong: warm bell-like resonance.
export function playGong(): void {
  if (isMuted()) return;
  playTone({
    freq: 196,
    type: 'sine',
    durationMs: 900,
    peakGain: 0.2,
    attackMs: 5,
    releaseMs: 800,
  });
  playTone({
    freq: 392,
    type: 'sine',
    durationMs: 900,
    peakGain: 0.1,
    attackMs: 5,
    releaseMs: 800,
  });
}

// Defeat horn: descending muted blast.
export function playRetreat(): void {
  if (isMuted()) return;
  playTone({
    freq: 220,
    type: 'sawtooth',
    durationMs: 700,
    peakGain: 0.18,
    attackMs: 30,
    releaseMs: 500,
    glideTo: 80,
  });
}
