/**
 * quality — the one place the hero's performance decisions are made.
 *
 * Ported from Project Phoenix's AdaptiveQualityManager and cut to the dials
 * this scene actually has. Every visual system subscribes and applies the
 * settings it is handed; none of them measures frame time or reacts on its
 * own. A system that watches its own fps is a bug, however well it works in
 * isolation.
 *
 *   classify()  device → particle pool, starting step, flame quality, caps
 *   tick()      one call per rendered frame; decisions on 1 s windows:
 *                 - warm-up: the first 2.5 s are shader compiles, ignored
 *                 - under 90% of target for 2 windows → one step down
 *                 - at target for 3 windows            → one step up, unless
 *                   that step failed recently (the ban doubles each time, so
 *                   a device never oscillates across its own limit)
 *                 - 3 s settle after every change before judging again
 *               steps go particles first; below the lowest particle step the
 *               render scale drops, and it is the first thing restored
 *   blend       the drawn particle count eases toward its step over ~1.5 s,
 *               so a change never pops
 *
 * The display's refresh rate caps what rAF can report, so the target is
 * min(60, refresh). At the cap there is no measurable headroom; the manager
 * steps up and lets the next windows decide, which is what the ban is for.
 */

/** Share of the pool drawn at each step. */
export const STEPS = [0.0625, 0.125, 0.25, 0.375, 0.5, 0.75, 1];
/** Render scales tried, in order, once the particle floor is reached. */
const SCALES = [1, 0.85, 0.7];
const WARMUP_MS = 2500;
const SETTLE_MS = 3000;
const WINDOW_MS = 1000;
const BAN_MS = 30000;

/** @typedef {'webgpu' | 'webgl2-fallback'} Backend */

/**
 * @typedef {object} Classification
 * @property {number} pool          particles allocated for the session
 * @property {number} step          starting index into STEPS
 * @property {number} maxStep       highest step the device may reach
 * @property {number} flameSteps    raymarch steps for the flame volume
 * @property {string} device        'discrete' | 'integrated' | 'mobile' | 'fallback'
 * @property {string | null} cappedBy
 * @property {boolean} forced       pool and step fixed by ?particles=N
 */

/**
 * Integrated adapters share system memory and bandwidth. Intel Arc is
 * discrete and is excluded. Same list Phoenix's TierAssigner uses.
 * @param {string} name
 */
export function isIntegrated(name) {
  const n = name.toLowerCase();
  if (/\barc\b/.test(n)) return false;
  return /intel|iris|uhd|gen-9|gen-11|gen-12|\bxe\b|radeon\(tm\) graphics|780m|680m|760m|610m|vega [0-9]|adreno|mali|powervr|apple|swiftshader|llvmpipe/.test(n);
}

/**
 * @param {{ backend: Backend, adapter: string, coarsePointer: boolean,
 *           deviceMemory: number, maxBufferBytes: number, forceCount: number }} env
 * @returns {Classification}
 */
export function classify(env) {
  if (env.backend !== 'webgpu') {
    // The WebGL2 fallback's transform-feedback compute draws nothing (found
    // on Phoenix, 2026-09-25), so it gets no particle system at all.
    return { pool: 0, step: 0, maxStep: 0, flameSteps: 20, device: 'fallback', cappedBy: 'no WebGPU adapter', forced: false };
  }
  // 16 bytes per particle per vec4 buffer; the largest single buffer bounds the pool.
  const bufferCap = Math.floor(env.maxBufferBytes / 16);
  if (env.forceCount > 0) {
    const pool = Math.min(env.forceCount, bufferCap, 8_000_000);
    return { pool, step: STEPS.length - 1, maxStep: STEPS.length - 1, flameSteps: 26, device: 'forced', cappedBy: pool < env.forceCount ? 'max buffer size' : null, forced: true };
  }
  const mobile = env.coarsePointer || (env.deviceMemory > 0 && env.deviceMemory <= 4);
  if (mobile) {
    return { pool: Math.min(250_000, bufferCap), step: 1, maxStep: STEPS.length - 1, flameSteps: 18, device: 'mobile', cappedBy: 'coarse pointer or ≤ 4 GB', forced: false };
  }
  const pool = Math.min(1_000_000, bufferCap);
  const cappedBy = pool < 1_000_000 ? 'max buffer size' : null;
  if (isIntegrated(env.adapter)) {
    return { pool, step: 2, maxStep: STEPS.length - 1, flameSteps: 22, device: 'integrated', cappedBy, forced: false };
  }
  return { pool, step: STEPS.length - 1, maxStep: STEPS.length - 1, flameSteps: 32, device: 'discrete', cappedBy, forced: false };
}

/**
 * @typedef {object} QualitySettings
 * @property {number} particles      particles to draw this frame (blended)
 * @property {number} particleStep   the count the blend is heading for
 * @property {number} renderScale    multiplier on the capped pixel ratio
 * @property {number} fps            last full window
 * @property {number} targetFPS
 * @property {string} reason         why the last change happened
 */

export class AdaptiveQuality {
  /** @param {Classification} c */
  constructor(c) {
    this.c = c;
    this.step = c.step;
    this.scaleIdx = 0;
    this.drawn = c.pool * STEPS[c.step];
    this.displayHz = 60;
    this.targetFPS = 60;
    this.reason = c.forced ? 'forced by ?particles' : `start: ${c.device}`;
    /** @type {Map<string, { until: number, ms: number }>} failed configurations */
    this.bans = new Map();
    /** @type {((s: QualitySettings) => void)[]} */
    this.subs = [];
    this.t0 = NaN;
    this.lastChange = -Infinity;
    this.winStart = NaN;
    this.winFrames = 0;
    this.under = 0;
    this.over = 0;
    this.fps = NaN;
    this.lastEmit = 0;
    this.lastFrame = NaN;
  }

  /** @param {(s: QualitySettings) => void} fn */
  subscribe(fn) { this.subs.push(fn); fn(this.settings()); }

  /** @returns {QualitySettings} */
  settings() {
    return {
      particles: Math.round(this.drawn),
      particleStep: Math.round(this.c.pool * STEPS[this.step]),
      renderScale: SCALES[this.scaleIdx],
      fps: this.fps, targetFPS: this.targetFPS, reason: this.reason,
    };
  }

  emit() { const s = this.settings(); for (const f of this.subs) f(s); }

  key() { return `${this.step}/${this.scaleIdx}`; }

  /** @param {number} now @param {string} why */
  down(now, why) {
    const failed = this.key();
    const prev = this.bans.get(failed);
    const ms = prev ? prev.ms * 2 : BAN_MS;
    this.bans.set(failed, { until: now + ms, ms });
    if (this.step > 0) this.step--;
    else if (this.scaleIdx < SCALES.length - 1) this.scaleIdx++;
    else { this.reason = `at floor (${why})`; return; }
    this.reason = `down: ${why}`;
    this.lastChange = now;
    this.emit();
  }

  /** @param {number} now */
  up(now) {
    let step = this.step, scale = this.scaleIdx;
    if (scale > 0) scale--;
    else if (step < this.c.maxStep) step++;
    else return;
    const ban = this.bans.get(`${step}/${scale}`);
    if (ban && ban.until > now) return;
    this.step = step; this.scaleIdx = scale;
    this.reason = `up: ${this.fps.toFixed(0)} fps held`;
    this.lastChange = now;
    this.emit();
  }

  /**
   * Call once per rendered frame. Paused frames (hero off-screen) must not
   * be reported, or the gap reads as one enormous frame.
   * @param {number} now performance.now()
   */
  tick(now) {
    if (!Number.isFinite(this.t0)) { this.t0 = now; this.winStart = now; this.lastFrame = now; }
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // blend the drawn count toward the step: ~1.5 s to cover a step
    const goal = this.c.pool * STEPS[this.step];
    if (Math.abs(goal - this.drawn) > 1) {
      this.drawn += (goal - this.drawn) * (1 - Math.exp(-dt / 0.5));
      if (Math.abs(goal - this.drawn) < this.c.pool * 0.002) this.drawn = goal;
      if (now - this.lastEmit > 100) { this.lastEmit = now; this.emit(); }
    }

    this.winFrames++;
    if (now - this.winStart < WINDOW_MS) return;
    this.fps = (this.winFrames * 1000) / (now - this.winStart);
    this.winStart = now; this.winFrames = 0;

    const age = now - this.t0;
    // refresh estimate from the best early windows (60, 75, 90, 120, 144 Hz)
    if (age < 6000) {
      const hz = this.fps > 130 ? 144 : this.fps > 100 ? 120 : this.fps > 80 ? 90 : this.fps > 68 ? 75 : 60;
      this.displayHz = Math.max(this.displayHz, hz);
    }
    this.targetFPS = Math.min(60, Math.round(this.displayHz * 0.97));
    if (this.c.forced || age < WARMUP_MS || now - this.lastChange < SETTLE_MS) { this.under = 0; this.over = 0; return; }

    if (this.fps < this.targetFPS * 0.9) { this.under++; this.over = 0; }
    else if (this.fps >= this.targetFPS * 0.97) { this.over++; this.under = 0; }
    else { this.under = 0; this.over = 0; }

    if (this.under >= 2) { this.under = 0; this.down(now, `${this.fps.toFixed(0)} < ${this.targetFPS} fps`); }
    else if (this.over >= 3) { this.over = 0; this.up(now); }
  }
}
