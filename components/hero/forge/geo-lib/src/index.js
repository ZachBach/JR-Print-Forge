/**
 * geo-lib — procedural geometry for the studio's three.js projects.
 *
 * The counterpart to tsl-lib: that one shades surfaces, this one makes them.
 *
 * Every builder takes the three.js namespace as its first argument and imports
 * nothing external. See docs/CONVENTIONS.md for why that is not negotiable.
 *
 * This barrel is a convenience for bundled consumers. A project that inlines
 * modules one at a time — the Aurelius landing bundle does — should import the
 * individual files instead, and nothing here depends on going through here.
 */
export { loft } from './core/loft.js';
export { merge } from './core/merge.js';
export { assembly } from './core/assembly.js';
export { revolve } from './solid/revolve.js';
export { tube } from './solid/tube.js';
export { roundedBox } from './solid/roundedBox.js';
export { normalizeModel } from './model/normalize.js';
