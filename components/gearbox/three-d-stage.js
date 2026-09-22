// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).
/* BEGIN USAGE */
/**
 * <three-d-stage> — 3D object viewer + exporter shell (three.js).
 *
 * RENDERER: chosen from the page's import map, not from an attribute. Map
 * "three" to build/three.webgpu.js and the stage builds a WebGPURenderer
 * (falling back to that renderer's own WebGL2 backend when no adapter is
 * available); map it to build/three.module.js and you get the classic
 * WebGLRenderer. Read `stage.api` for what actually ended up running —
 * 'webgpu' | 'webgl2-fallback' | 'webgl'. Add the `forcewebgl` attribute to
 * pin the fallback for debugging. See index.html for the WebGPU/TSL map.
 *
 * The stage owns the whole scene: the renderer, neutral studio lighting
 * with a soft ground shadow, orbit controls (drag to orbit, wheel to zoom,
 * right-drag to pan), a camera auto-framed to the object's bounds, resize
 * handling, and a download toolbar that exports the current object as
 * OBJ + MTL or GLB (binary glTF). FBX cannot be exported in the browser;
 * GLB is the interchange format every modern 3D tool imports.
 *
 * three.js loads through the page's import map. Include this EXACT pinned
 * map in <head>, before any module runs — versions and integrity hashes
 * stay together (same map the "3D object" skill mandates):
 *
 *   <script type="importmap">
 *   {
 *     "imports": {
 *       "three": "https://unpkg.com/three@0.184.0/build/three.module.js",
 *       "three/addons/controls/OrbitControls.js": "https://unpkg.com/three@0.184.0/examples/jsm/controls/OrbitControls.js",
 *       "three/addons/exporters/OBJExporter.js": "https://unpkg.com/three@0.184.0/examples/jsm/exporters/OBJExporter.js",
 *       "three/addons/exporters/GLTFExporter.js": "https://unpkg.com/three@0.184.0/examples/jsm/exporters/GLTFExporter.js"
 *     },
 *     "integrity": {
 *       "https://unpkg.com/three@0.184.0/build/three.module.js": "sha384-8FCZ1eVO6it4+pbec2aDtnTrwjWXZLJRC+MAGCIPDgsYnUrl/E0A2YlF8ioMKI/J",
 *       "https://unpkg.com/three@0.184.0/build/three.core.js": "sha384-dw2ooPewaEIrAgl6oFDBmmBWCE9oW9LxRGcfwZ0hLvEprzo202wXl7vCYHRlSnOT",
 *       "https://unpkg.com/three@0.184.0/examples/jsm/controls/OrbitControls.js": "sha384-4rziNxOBZKQ69i+w+f89KJ55TCYquwchVbByQwmaOeIOXdOU2PLDn3kOfXHwIJC9",
 *       "https://unpkg.com/three@0.184.0/examples/jsm/exporters/OBJExporter.js": "sha384-nbwtoZENJD3Vq+ACK0CuGQdPMuDWHkamC2KJD70EV5nfg6jQjfppKOea07YJN+N3",
 *       "https://unpkg.com/three@0.184.0/examples/jsm/exporters/GLTFExporter.js": "sha384-VofkvpG6HERhFCYbsUOHeNXBCqID2nfqkQqnVzE1jc/oPcz+qJ13ADdXH08hE+cQ"
 *     }
 *   }
 *   </script>
 *
 * Usage:
 *   <style>three-d-stage:not(:defined){visibility:hidden}</style>
 *   <three-d-stage name="rocket"></three-d-stage>
 *   <script src="three-d-stage.js"></script>
 *   <script type="module">
 *     const stage = document.querySelector('three-d-stage');
 *     const { THREE } = await stage.ready;
 *     const model = new THREE.Group();
 *     // …build the model out of named meshes with named materials —
 *     // the names become the o / usemtl entries in the exported OBJ…
 *     stage.setObject(model);
 *   </script>
 *
 * Attributes:
 *   name       — export file basename (default "model")
 *   background — CSS color behind the scene (default a warm paper tone)
 *   autorotate — when present, a slow turntable until the user interacts
 *
 * Model in real-world meters, centered on the origin, y-up — exports
 * inherit the scene's units and orientation. The stage fills its own box;
 * size it with ordinary CSS (default 100vw/100vh page hero).
 *
 * Default setup: neutral studio lighting (hemisphere + key + fill), a
 * soft ground shadow, and NO environment map — so high metalness has
 * nothing to reflect and renders near-black. Cap metalness around
 * 0.3–0.4 and carry a metal look with a brighter base color. The copied
 * file is yours: adjust the lights, shadow, or background in _boot()
 * when the object needs a different look.
 */
/* END USAGE */

(() => {
  const stylesheet = `
    :host {
      position: relative;
      display: block;
      width: 100%;
      height: 100vh;
      background: var(--stage-bg, #f0eee6);
      overflow: hidden;
    }
    canvas { display: block; outline: none; }
    .toolbar {
      position: absolute;
      right: 16px;
      bottom: 16px;
      display: flex;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .toolbar button {
      appearance: none;
      border: 1px solid rgba(20, 20, 19, 0.18);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.92);
      color: #1a1915;
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 500;
      line-height: 1;
      padding: 9px 12px;
      cursor: default;
    }
    .toolbar button:hover { background: #fff; }
    .toolbar button:active { transform: translateY(1px); }
    .toolbar button[disabled] { opacity: 0.5; pointer-events: none; }
    .note {
      position: absolute;
      left: 16px;
      bottom: 16px;
      max-width: 60%;
      font: 400 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: rgba(26, 25, 21, 0.55);
      user-select: none;
    }
    .err {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font: 500 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #8a2f20;
      text-align: center;
      white-space: pre-line;
    }
  `;

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** Tell the host an export attempt settled — telemetry only. The host
   *  (HTMLViewer) verifies the source and re-reads these fields defensively
   *  before counting; nothing else crosses the frame boundary. Guarded so
   *  telemetry can never break the download path. */
  function notifyExport(format, ok) {
    try {
      window.parent.postMessage(
        { type: 'omelette:notify-3d-export', format: format, ok: ok === true },
        '*'
      );
    } catch (e) {}
  }

  class ThreeDStage extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = stylesheet;
      root.appendChild(style);
      this._err = document.createElement('div');
      this._err.className = 'err';
      root.appendChild(this._err);
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = 'Drag to orbit · scroll to zoom · right-drag to pan';
      root.appendChild(note);
      this._toolbar = document.createElement('div');
      this._toolbar.className = 'toolbar';
      this._objBtn = document.createElement('button');
      this._objBtn.type = 'button';
      this._objBtn.textContent = 'Download OBJ + MTL';
      this._objBtn.addEventListener('click', () => this._runExport('obj'));
      this._glbBtn = document.createElement('button');
      this._glbBtn.type = 'button';
      this._glbBtn.textContent = 'Download GLB';
      this._glbBtn.addEventListener('click', () => this._runExport('glb'));
      this._stlBtn = document.createElement('button');
      this._stlBtn.type = 'button';
      this._stlBtn.textContent = 'Download STL (mm)';
      this._stlBtn.addEventListener('click', () => this._runExport('stl'));
      this._toolbar.appendChild(this._stlBtn);
      this._toolbar.appendChild(this._objBtn);
      this._toolbar.appendChild(this._glbBtn);
      root.appendChild(this._toolbar);
      // hide-toolbar: host page owns the export flow (e.g. purchase-gated) —
      // the export methods stay callable, only the built-in buttons hide.
      if (this.hasAttribute('hide-toolbar')) this._toolbar.style.display = 'none';
      this._setButtonsEnabled(false);
      /** Resolves with { THREE } once the scene is live — build the model
       *  in `await stage.ready` so nothing races the library load. */
      this.ready = new Promise((resolve, reject) => {
        this._readyResolve = resolve;
        this._readyReject = reject;
      });
    }

    connectedCallback() {
      if (this._booted) {
        // Re-attached after a removal — resume what disconnected stopped.
        if (this._renderer) {
          this._renderer.setAnimationLoop(this._loop);
          this._ro && this._ro.observe(this);
        }
        return;
      }
      this._booted = true;
      this._boot().catch((err) => {
        this._err.style.display = 'flex';
        this._err.textContent =
          'three.js failed to load.\n' +
          'Check that the pinned <script type="importmap"> from the usage ' +
          'notes is in <head> before any module script.\n\n' +
          String(err && err.message ? err.message : err);
        this._readyReject(err);
      });
    }

    async _boot() {
      const bg = this.getAttribute('background');
      if (bg) this.style.setProperty('--stage-bg', bg);
      const [THREE, controlsMod] = await Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js'),
      ]);
      this._THREE = THREE;

      /* Renderer selection is driven by the page's import map, not by an
         attribute. A page that maps "three" to build/three.webgpu.js gets a
         WebGPURenderer; one that maps it to build/three.module.js gets the
         classic WebGLRenderer. The webgpu build does not export WebGLRenderer
         at all, so this check is unambiguous — and it lets one component serve
         both pages while Track 3 lands page by page.

         WebGPURenderer is not "WebGPU or nothing": when the adapter is
         unavailable it falls back to its own WebGL2 backend, so the same code
         path still renders on older browsers. `forcewebgl` on the element
         pins that fallback for debugging. */
      const wantsWebGPU = typeof THREE.WebGPURenderer === 'function';
      let renderer;
      if (wantsWebGPU) {
        renderer = new THREE.WebGPURenderer({
          antialias: true,
          alpha: true,
          forceWebGL: this.hasAttribute('forcewebgl'),
        });
        // Device/adapter acquisition is async. Awaiting here means nothing
        // downstream — setObject, the animation loop, exports — can race a
        // half-initialised device.
        await renderer.init();
      } else {
        // preserveDrawingBuffer keeps the last frame readable after
        // compositing (toDataURL / drawImage) — it's what lets the
        // screenshot tools capture the scene instead of a blank canvas.
        // It is a WebGL-only context attribute.
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
        });
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this._renderer = renderer;
      /* What actually ended up running, for the page to display honestly.
         backend.isWebGPUBackend is the only truthful answer — asking whether
         WebGPURenderer was constructed would report "webgpu" on a machine that
         silently fell back to WebGL2. */
      this._api = !wantsWebGPU ? 'webgl'
        : (renderer.backend && renderer.backend.isWebGPUBackend) ? 'webgpu' : 'webgl2-fallback';
      this.shadowRoot.insertBefore(renderer.domElement, this._err);

      const scene = new THREE.Scene();
      this._scene = scene;

      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
      camera.position.set(3, 2.2, 4);
      this._camera = camera;

      const controls = new controlsMod.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      this._controls = controls;

      // Neutral studio: soft sky/ground wash, a shadow-casting key light,
      // and a dim fill from behind so silhouettes never go black.
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(4, 7, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0002;
      this._key = key;
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
      fill.position.set(-5, 3, -4);
      scene.add(fill);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.ShadowMaterial({ opacity: 0.18 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this._ground = ground;
      scene.add(ground);

      this._autorotate = this.hasAttribute('autorotate');
      controls.autoRotate = this._autorotate;
      controls.autoRotateSpeed = 1.2;
      controls.addEventListener('start', () => {
        controls.autoRotate = false;
      });

      const fit = () => {
        const w = this.clientWidth || 1;
        const h = this.clientHeight || 1;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      fit();
      this._ro = new ResizeObserver(fit);
      this._loop = () => {
        controls.update();
        renderer.render(scene, camera);
      };
      // Detached while three.js was fetching? Stay idle — the
      // connectedCallback resume starts the loop and observer on
      // reattach.
      if (this.isConnected) {
        this._ro.observe(this);
        renderer.setAnimationLoop(this._loop);
      }

      this._readyResolve({ THREE, api: this._api, renderer });
    }

    disconnectedCallback() {
      // Stop rendering and observing while detached; connectedCallback
      // resumes both. (The renderer itself is kept — a move within the
      // document must not rebuild the scene.)
      if (this._renderer) this._renderer.setAnimationLoop(null);
      if (this._ro) this._ro.disconnect();
    }

    /** Show (and own) the object. Replaces any previous object, enables
     *  shadows on every mesh, rests it on the ground plane, and frames
     *  the camera to its bounds. */
    setObject(object) {
      const THREE = this._THREE;
      if (!THREE) throw new Error('three-d-stage: not ready — await stage.ready first');
      if (this._object) this._scene.remove(this._object);
      this._object = object;
      object.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      /* Frame on the hardware only. Viewer-only helpers (userData.noExport —
         the radar disc, the airflow and LIDAR sprite clouds) must not drive
         the camera: the radar is deliberately sized 1.55x the model, and an
         instanced Sprite reports the bounds of its shared +/-0.5 quad, which
         is metres wide next to a 140 mm mask. Either one pushes the camera
         back far enough to shrink the subject to a dot. */
      const box = new THREE.Box3();
      object.traverse((o) => {
        if (o === object || !o.isMesh) return;
        if (o.userData && o.userData.noExport) return;
        box.expandByObject(o);
      });
      if (box.isEmpty()) box.setFromObject(object); // no tagged meshes — fall back
      if (!box.isEmpty()) {
        // Rest the object on the ground without moving its origin.
        this._ground.position.y = box.min.y;
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const dist =
          (sphere.radius / Math.tan((this._camera.fov * Math.PI) / 360)) * 1.35;
        const dir = new THREE.Vector3(1, 0.55, 1.25).normalize();
        this._camera.position
          .copy(sphere.center)
          .add(dir.multiplyScalar(dist));
        this._camera.near = Math.max(dist / 100, 0.01);
        this._camera.far = dist * 100;
        this._camera.updateProjectionMatrix();
        this._controls.target.copy(sphere.center);
        this._controls.update();
        const span = sphere.radius * 3;
        this._key.shadow.camera.left = -span;
        this._key.shadow.camera.right = span;
        this._key.shadow.camera.top = span;
        this._key.shadow.camera.bottom = -span;
        this._key.shadow.camera.updateProjectionMatrix();
      }
      this._scene.add(object);
      this._setButtonsEnabled(true);
    }

    get _basename() {
      return (this.getAttribute('name') || 'model').replace(/[^\w.-]+/g, '_');
    }

    _setButtonsEnabled(on) {
      this._stlBtn.disabled = !on;
      this._objBtn.disabled = !on;
      this._glbBtn.disabled = !on;
    }

    /** Every mesh and material needs a unique name for o/usemtl lines —
     *  fill in stable fallbacks, and return the unique material list. */
    _nameParts() {
      const mats = [];
      const seen = new Set();
      let meshI = 0;
      let matI = 0;
      this._object.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.name) o.name = 'part_' + meshI;
        meshI += 1;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          if (!m || mats.includes(m)) continue;
          if (!m.name) {
            m.name = 'mat_' + matI;
            matI += 1;
          }
          while (seen.has(m.name)) {
            m.name = m.name + '_' + matI;
            matI += 1;
          }
          seen.add(m.name);
          mats.push(m);
        }
      });
      return mats;
    }

    /** One export attempt, reported to the host however it settles.
     *  Rethrows so a failure stays visible on the guest console exactly as
     *  before. The no-object early return is not an attempt (the toolbar is
     *  disabled until the model loads) and reports nothing. */
    async _runExport(format) {
      if (!this._object) return;
      // Viewer-only helpers (grids, point clouds, radar) must never reach a
      // print or an interchange file — park them for the duration.
      const parked = [];
      // Park invisible meshes too: OBJExporter has no visibility check, so
      // without this a hidden part silently lands in .obj while STL/GLB skip it.
      this._object.traverse((o) => {
        if (o === this._object) return;
        const flagged = o.userData && o.userData.noExport;
        if (flagged || (o.isMesh && !o.visible)) parked.push([o, o.parent]);
      });
      for (const [o, p] of parked) if (p) p.remove(o);
      try {
        if (format === 'obj') await this._exportObj();
        else if (format === 'stl') await this._exportStl();
        else await this._exportGlb();
        notifyExport(format, true);
      } catch (err) {
        notifyExport(format, false);
        throw err;
      } finally {
        for (const [o, p] of parked) if (p) p.add(o);
      }
    }

    /** Live scene → binary STL in millimetres (print units). Only visible
     *  meshes are written, so hidden parts stay out of the print. */
    async _exportStl() {
      if (!this._object) return;
      const S = 1000, meshes = [];
      this._object.updateMatrixWorld(true);
      this._object.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        let p = o, shown = true;
        while (p && p !== this._object) { if (!p.visible) { shown = false; break; } p = p.parent; }
        if (shown && o.geometry && o.geometry.getAttribute('position')) meshes.push(o);
      });
      let count = 0;
      for (const m of meshes) {
        const g = m.geometry;
        count += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      }
      const buf = new ArrayBuffer(84 + count * 50), dv = new DataView(buf);
      const head = 'Exported by three-d-stage - units: millimetres';
      for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) : 32);
      dv.setUint32(80, count, true);
      let o = 84;
      const T3 = this._THREE, v = [new T3.Vector3(), new T3.Vector3(), new T3.Vector3()];
      const ab = new T3.Vector3(), cb = new T3.Vector3(), nn = new T3.Vector3();
      for (const m of meshes) {
        const g = m.geometry, pos = g.getAttribute('position'), ix = g.index;
        const n = ix ? ix.count : pos.count;
        for (let i = 0; i < n; i += 3) {
          for (let e = 0; e < 3; e++) {
            const kk = ix ? ix.getX(i + e) : i + e;
            v[e].fromBufferAttribute(pos, kk).applyMatrix4(m.matrixWorld).multiplyScalar(S);
          }
          cb.subVectors(v[2], v[1]); ab.subVectors(v[0], v[1]);
          nn.copy(cb.cross(ab)); if (nn.lengthSq() > 0) nn.normalize();
          dv.setFloat32(o, nn.x, true); dv.setFloat32(o + 4, nn.y, true); dv.setFloat32(o + 8, nn.z, true);
          for (let e = 0; e < 3; e++) {
            dv.setFloat32(o + 12 + e * 12, v[e].x, true);
            dv.setFloat32(o + 16 + e * 12, v[e].y, true);
            dv.setFloat32(o + 20 + e * 12, v[e].z, true);
          }
          dv.setUint16(o + 48, 0, true); o += 50;
        }
      }
      download(new Blob([buf], { type: 'model/stl' }), this._basename + '.stl');
    }

    async _exportObj() {
      if (!this._object) return;
      const mod = await import('three/addons/exporters/OBJExporter.js');
      const mats = this._nameParts();
      const base = this._basename;
      const obj =
        'mtllib ' + base + '.mtl\n' + new mod.OBJExporter().parse(this._object);
      let mtl = '# Exported by three-d-stage\n';
      for (const m of mats) {
        const c = m.color || { r: 0.8, g: 0.8, b: 0.8 };
        const rough = typeof m.roughness === 'number' ? m.roughness : 0.5;
        const opacity = typeof m.opacity === 'number' ? m.opacity : 1;
        mtl += 'newmtl ' + m.name + '\n';
        mtl +=
          'Kd ' + c.r.toFixed(4) + ' ' + c.g.toFixed(4) + ' ' + c.b.toFixed(4) + '\n';
        mtl += 'Ks 0.2000 0.2000 0.2000\n';
        mtl += 'Ns ' + Math.round((1 - rough) * 200) + '\n';
        mtl += 'd ' + opacity.toFixed(4) + '\n\n';
      }
      download(new Blob([obj], { type: 'text/plain' }), base + '.obj');
      download(new Blob([mtl], { type: 'text/plain' }), base + '.mtl');
    }

    async _exportGlb() {
      if (!this._object) return;
      const mod = await import('three/addons/exporters/GLTFExporter.js');
      this._nameParts();
      const base = this._basename;
      const buf = await new mod.GLTFExporter().parseAsync(this._object, {
        binary: true,
      });
      download(
        new Blob([buf], { type: 'model/gltf-binary' }),
        base + '.glb'
      );
    }
  }

  Object.defineProperties(ThreeDStage.prototype, {
    /** 'webgpu' | 'webgl2-fallback' | 'webgl' — what is actually rendering. */
    api:      { get: function () { return this._api; } },
    renderer: { get: function () { return this._renderer; } },
    scene:    { get: function () { return this._scene; } },
    camera:   { get: function () { return this._camera; } },
    controls: { get: function () { return this._controls; } }
  });

  customElements.define('three-d-stage', ThreeDStage);
})();