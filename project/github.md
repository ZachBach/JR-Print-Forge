repo: ZachBach/AureliusDynamic
branch: master
path: tsl-lib/src, geo-lib/src

Also read (not tracked here): ZachBach/pulsemask@main — design language reference
(tokens, type scale, component treatments) for the PulseMask site.

## Last sync
date: 2026-09-21T22:59:18Z

### Updated in this project
- Copied tsl-lib nodes (noise, ramp, pattern, fresnel, materials) into `tsl-lib/src/`
- Copied geo-lib builders (loft, revolve, tube, roundedBox, merge, assembly) into `geo-lib/src/`
- Added `jr-palette.js` — JR brand colors in the tsl-lib palette contract
- Hero shading composed from fbm / warp / stripes / ramp / fireRamp / fresnel / horizonBand

## Screen map
| Screen | Built from |
| --- | --- |
| `JR Print Forge.dc.html` hero | `forge-hero.js`, `forge-scene.js`, `forge-materials.js`, `flame-volume.js` |
| Forge shading | `tsl-lib/src/{noise,ramp,pattern,fresnel}/*`, `jr-palette.js` |
| Forge geometry | `geo-lib/src/solid/{roundedBox,revolve,tube}.js` |
| `Planetary Gearbox.html` | `gearbox.js` + `three-d-stage.js` (starter) |
| Volumetric fire | `flame-volume.js` (approach after mrdoob/three.js#33848) |
