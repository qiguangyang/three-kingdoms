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

// Rising rush for a cavalry charge.
export function playCharge(): void {
  if (isMuted()) return;
  playTone({ freq: 160, type: 'sawtooth', durationMs: 260, peakGain: 0.14, attackMs: 8, releaseMs: 120, glideTo: 320 });
}

// Short hiss cluster for an arrow volley.
export function playVolley(): void {
  if (isMuted()) return;
  for (const offsetMs of [0, 40, 80]) {
    setTimeout(() => playTone({ freq: 1400, type: 'triangle', durationMs: 90, peakGain: 0.05, attackMs: 2, releaseMs: 70, glideTo: 700 }), offsetMs);
  }
}

// Low roar for a fire attack.
export function playFire(): void {
  if (isMuted()) return;
  playTone({ freq: 90, type: 'sawtooth', durationMs: 420, peakGain: 0.16, attackMs: 20, releaseMs: 260, glideTo: 60 });
  playTone({ freq: 300, type: 'square', durationMs: 300, peakGain: 0.05, attackMs: 10, releaseMs: 200, glideTo: 140 });
}

// Two-note clash for a general's duel.
export function playDuel(): void {
  if (isMuted()) return;
  playTone({ freq: 990, type: 'square', durationMs: 120, peakGain: 0.1, attackMs: 2, releaseMs: 90, glideTo: 660 });
  setTimeout(() => playTone({ freq: 1240, type: 'square', durationMs: 140, peakGain: 0.1, attackMs: 2, releaseMs: 110, glideTo: 520 }), 130);
}

// Falling tone for a rout.
export function playRout(): void {
  if (isMuted()) return;
  playTone({ freq: 420, type: 'sine', durationMs: 380, peakGain: 0.12, attackMs: 6, releaseMs: 260, glideTo: 90 });
}

// ── Procedural battle music bed ─────────────────────────────────────────────
// A low drone (root/fifth/octave through a slowly-sweeping lowpass) under a war
// drum whose tempo and weight rise with the fighting. Synthesized — no assets —
// and it sits quietly under the event SFX. start on Begin, stop on finish/leave.
interface Music {
  master: GainNode;
  filter: BiquadFilterNode;
  drone: OscillatorNode[];
  lfo: OscillatorNode;
  drumTimer: ReturnType<typeof setTimeout> | null;
  intensity: number;
}
let music: Music | null = null;

function drumHit(c: AudioContext, dest: AudioNode, intensity: number): void {
  const now = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(94, now);
  o.frequency.exponentialRampToValueAtTime(42, now + 0.16);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.28 + intensity * 0.34, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, now + 0.34);
  o.connect(g).connect(dest);
  o.start(now);
  o.stop(now + 0.4);
}

export function startBattleMusic(): void {
  const c = ensureCtx();
  if (!c || music) return;
  const master = c.createGain();
  master.gain.setValueAtTime(0, c.currentTime);
  master.gain.linearRampToValueAtTime(0.2, c.currentTime + 2.5); // gentle fade-in
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 460;
  filter.Q.value = 0.9;
  filter.connect(master).connect(c.destination);
  const drone = [55, 82.5, 110].map((f, i) => {
    const o = c.createOscillator();
    o.type = i === 0 ? 'sawtooth' : 'triangle';
    o.frequency.value = f;
    o.detune.value = (i - 1) * 5;
    const g = c.createGain();
    g.gain.value = i === 0 ? 0.42 : 0.22;
    o.connect(g).connect(filter);
    o.start();
    return o;
  });
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 200;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();
  music = { master, filter, drone, lfo, drumTimer: null, intensity: 0.2 };
  const beat = (): void => {
    if (!music) return;
    drumHit(c, master, music.intensity);
    music.drumTimer = setTimeout(beat, 1500 - music.intensity * 650); // faster when intense
  };
  beat();
}

// 0 = calm deployment, 1 = full melee — drives drum tempo + weight.
export function setBattleIntensity(x: number): void {
  if (music) music.intensity = Math.max(0, Math.min(1, x));
}

export function stopBattleMusic(): void {
  if (!music || !ctx) return;
  const c = ctx;
  const m = music;
  music = null;
  if (m.drumTimer) clearTimeout(m.drumTimer);
  const now = c.currentTime;
  m.master.gain.cancelScheduledValues(now);
  m.master.gain.setValueAtTime(m.master.gain.value, now);
  m.master.gain.linearRampToValueAtTime(0, now + 1.2);
  const stopAt = now + 1.3;
  for (const o of m.drone) { try { o.stop(stopAt); } catch { /* already stopped */ } }
  try { m.lfo.stop(stopAt); } catch { /* ignore */ }
}

export function musicPlaying(): boolean {
  return music !== null;
}
