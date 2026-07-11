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
  // bright metal-on-metal ping riding the top
  playTone({ freq: 2100, type: 'triangle', durationMs: 90, peakGain: 0.05, attackMs: 1, releaseMs: 80, glideTo: 1500 });
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

// Rising rush + a low rolling rumble of hooves for a cavalry charge.
export function playCharge(): void {
  if (isMuted()) return;
  playTone({ freq: 160, type: 'sawtooth', durationMs: 260, peakGain: 0.14, attackMs: 8, releaseMs: 120, glideTo: 320 });
  const hooves: [number, number][] = [[0, 70], [70, 62], [140, 74], [210, 60]];
  for (const [off, f] of hooves) {
    setTimeout(() => playTone({ freq: f, type: 'sine', durationMs: 95, peakGain: 0.13, attackMs: 4, releaseMs: 60, glideTo: f - 12 }), off);
  }
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
  // ringing steel that hangs in the air after the exchange
  setTimeout(() => playTone({ freq: 2600, type: 'triangle', durationMs: 460, peakGain: 0.045, attackMs: 1, releaseMs: 420, glideTo: 2100 }), 210);
}

// Falling tone for a rout.
export function playRout(): void {
  if (isMuted()) return;
  playTone({ freq: 420, type: 'sine', durationMs: 380, peakGain: 0.12, attackMs: 6, releaseMs: 260, glideTo: 90 });
}

// ── Battle music (AI-generated tracks, played as assets) ────────────────────
// The looping battle bed + victory/defeat themes are generated with ACE-Step
// (via the vuesub CLI) and shipped as mp3s in /public/audio. They play through
// <audio> elements, kept out of the WebAudio SFX graph above; the mute flag
// governs both layers. Combat SFX stay procedural — a music model can't
// synthesize sword-clash / arrow foley one-shots.
const AUDIO_BASE = '/audio/';
const BED_MAX_GAIN = 0.6; // bed volume at full intensity
const THEME_GAIN = 0.62;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
// Bed loudness rises with the fighting (calm at deployment, full in melee).
const bedVolume = (intensity: number): number => BED_MAX_GAIN * (0.5 + 0.5 * clamp01(intensity));

let bed: HTMLAudioElement | null = null;
let endTheme: HTMLAudioElement | null = null;
let bedIntensity = 0.4;
const fadeTimers = new WeakMap<HTMLAudioElement, ReturnType<typeof setInterval>>();

function makeTrack(file: string, loop: boolean): HTMLAudioElement | null {
  try {
    const a = new Audio(AUDIO_BASE + file);
    a.loop = loop;
    a.preload = 'auto';
    return a;
  } catch {
    return null; // Audio unavailable (e.g. jsdom) — degrade silently
  }
}

// play() may reject (autoplay policy), throw, or — under jsdom — return
// `undefined` instead of a Promise; swallow all three so callers never crash.
function safePlay(el: HTMLAudioElement): void {
  try {
    const p = el.play() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => { /* needs a gesture — retried later */ });
  } catch {
    /* not implemented / blocked — ignore */
  }
}

// Linear volume fade over `ms`, cancelling any fade already in flight on `el`.
function fadeTo(el: HTMLAudioElement, target: number, ms: number, onDone?: () => void): void {
  const prev = fadeTimers.get(el);
  if (prev) clearInterval(prev);
  const tgt = clamp01(target);
  if (ms <= 0 || typeof performance === 'undefined') { el.volume = tgt; onDone?.(); return; }
  const from = el.volume;
  const start = performance.now();
  const timer = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / ms);
    try { el.volume = clamp01(from + (tgt - from) * t); } catch { /* detached */ }
    if (t >= 1) { clearInterval(timer); fadeTimers.delete(el); onDone?.(); }
  }, 50);
  fadeTimers.set(el, timer);
}

function fadeOutAndStop(el: HTMLAudioElement, ms: number): void {
  fadeTo(el, 0, ms, () => { try { el.pause(); el.currentTime = 0; } catch { /* ignore */ } });
}

export function startBattleMusic(): void {
  if (isMuted() || bed) return;
  // A lingering victory/defeat theme from a previous battle gives way.
  if (endTheme) { fadeOutAndStop(endTheme, 600); endTheme = null; }
  bed = makeTrack('battle-bed.mp3', true);
  if (!bed) return;
  bed.volume = 0;
  safePlay(bed);
  fadeTo(bed, bedVolume(bedIntensity), 2400);
}

// 0 = calm deployment, 1 = full melee — modulates the bed's loudness.
export function setBattleIntensity(x: number): void {
  bedIntensity = clamp01(x);
  if (bed && !bed.paused) fadeTo(bed, bedVolume(bedIntensity), 1200);
}

export function stopBattleMusic(): void {
  const b = bed;
  bed = null;
  if (b) fadeOutAndStop(b, 1100);
}

// One-shot end themes: hand off from the bed to a triumphant / mournful cue.
function playTheme(file: string): void {
  if (isMuted()) return;
  stopBattleMusic();
  if (endTheme) fadeOutAndStop(endTheme, 400);
  const t = makeTrack(file, false);
  if (!t) return;
  endTheme = t;
  t.volume = 0;
  safePlay(t);
  fadeTo(t, THEME_GAIN, 500);
}
export function playVictoryTheme(): void { playTheme('victory.mp3'); }
export function playDefeatTheme(): void { playTheme('defeat.mp3'); }

export function musicPlaying(): boolean {
  return bed !== null;
}

// ── Campaign-map theme (a looping playlist) ─────────────────────────────────
// Five long, authentic Three Kingdoms-era pieces played back-to-back on an
// endless rotation under the campaign map. Separate from the battle bed — the
// two scenes never overlap. The browser may block the first play() (no gesture
// yet on a fresh load); we retry on the first user interaction. A track that
// fails to load (e.g. still being generated) is skipped rather than stalling
// the rotation — but if every track in a row fails, we give up.
const MAP_GAIN = 0.42;
const MAP_TRACKS = ['map-1.mp3', 'map-2.mp3', 'map-3.mp3', 'map-4.mp3', 'map-5.mp3'];
let mapActive = false;
let mapEl: HTMLAudioElement | null = null;
let mapIndex = 0;
let mapErrorStreak = 0;

function playMapTrack(i: number): void {
  if (!mapActive || isMuted()) return;
  const n = MAP_TRACKS.length;
  mapIndex = ((i % n) + n) % n;
  const el = makeTrack(MAP_TRACKS[mapIndex]!, false);
  if (!el) return;
  const prev = mapEl;
  mapEl = el;
  if (prev) fadeOutAndStop(prev, 1500);
  el.volume = 0;
  el.addEventListener('canplay', () => { mapErrorStreak = 0; }, { once: true });
  // Advance to the next track when this one finishes — an endless rotation.
  el.addEventListener('ended', () => { if (mapActive && mapEl === el) playMapTrack(mapIndex + 1); }, { once: true });
  // Skip a track that can't load, unless every track has failed in a row.
  el.addEventListener('error', () => {
    if (!mapActive || mapEl !== el) return;
    mapErrorStreak++;
    if (mapErrorStreak <= MAP_TRACKS.length) setTimeout(() => { if (mapActive && mapEl === el) playMapTrack(mapIndex + 1); }, 400);
  }, { once: true });
  safePlay(el);
  fadeTo(el, MAP_GAIN, 2500);
}

export function startMapMusic(): void {
  if (isMuted() || mapActive) return;
  mapActive = true;
  mapErrorStreak = 0;
  // Open on a rotating track so it doesn't always start on the same piece.
  const start = Math.floor((typeof performance !== 'undefined' ? performance.now() : 0) / 1000) % MAP_TRACKS.length;
  playMapTrack(start);
  try {
    const unlock = (): void => {
      window.removeEventListener('pointerdown', unlock);
      if (mapActive && mapEl && mapEl.paused) safePlay(mapEl); // resume if autoplay blocked it
    };
    window.addEventListener('pointerdown', unlock, { once: true });
  } catch {
    /* no window (SSR/tests) — ignore */
  }
}

export function stopMapMusic(): void {
  mapActive = false;
  const el = mapEl;
  mapEl = null;
  if (el) fadeOutAndStop(el, 1500);
}
