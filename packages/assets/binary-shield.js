/*
 * NexVault binary-shield animation.
 *
 * The shield is an EMPTY area punched through the binary rain:
 *  1. binary digits rain down across the full canvas
 *  2. a shield-shaped region is erased (destination-out) so no rain shows there
 *  3. that empty region is filled with a pulsing cyan-blue glow
 *
 * Self-contained: attach <canvas class="nv-canvas" data-nv-binary-shield"></canvas>.
 */
(function () {
  'use strict';

  const CHARS = '01';
  const FONT_SIZE = 14;
  const RAIN_DPR_CAP = 2;
  const GLOW = '#00d4ff'; // --nv-accent cyan

  // Closed shield-shaped polygon (filled region), centered upper-canvas.
  function makeShieldPolygon(w, h) {
    const cx = w / 2;
    const cy = h * 0.42;
    const sw = Math.min(w, h) * 0.30;
    const sh = sw * 1.18;
    const seg = 60;
    const poly = [];

    // top edge, slightly arched
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      poly.push([cx - sw / 2 + sw * t,
                 cy - sh / 2 + Math.sin(t * Math.PI) * -sh * 0.06]);
    }
    // right side curving to bottom point
    for (let i = 1; i <= seg; i++) {
      const t = i / seg;
      poly.push([cx + sw / 2 - (sw / 2) * Math.pow(t, 2.2),
                 cy - sh / 2 + sh * t]);
    }
    // left side back up to start (closes the shape)
    for (let i = 1; i <= seg; i++) {
      const t = i / seg;
      poly.push([cx - (sw / 2) * Math.pow(1 - t, 2.2),
                 cy + sh / 2 - sh * t]);
    }
    return poly;
  }

  function drawPolygonPath(ctx, poly) {
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      if (i === 0) ctx.moveTo(poly[i][0], poly[i][1]);
      else ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
  }

  function startShield(canvas) {
    const ctx = canvas.getContext('2d');
    let w, h, dpr;
    let columns, drops, speeds;
    let shield = null;
    let frame = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, RAIN_DPR_CAP);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      columns = Math.max(8, Math.floor(w / FONT_SIZE));
      drops = Array.from({ length: columns }, () => Math.random() * -50);
      speeds = Array.from({ length: columns }, () => 0.35 + Math.random() * 0.65);
      shield = makeShieldPolygon(w, h);
    }

    function drawRain() {
      for (let i = 0; i < columns; i++) {
        const ch = CHARS[(Math.random() * CHARS.length) | 0];
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;
        ctx.fillStyle = Math.random() < 0.06 ? '#b6ffe0' : 'rgba(0, 255, 157, 0.75)';
        ctx.fillText(ch, x, y);
        drops[i] += speeds[i];
        if (y > h + FONT_SIZE * 4 && Math.random() > 0.96) drops[i] = Math.random() * -20;
      }
    }

    function drawFrame() {
      // trailing dark fill for fade
      ctx.fillStyle = 'rgba(4, 6, 12, 0.18)';
      ctx.fillRect(0, 0, w, h);

      ctx.font = FONT_SIZE + 'px monospace';
      drawRain();

      // erase the shield region -> rain disappears there (empty area)
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      drawPolygonPath(ctx, shield);
      ctx.fill();
      ctx.restore();

      // fill the empty area with a pulsing cyan-blue glow
      const pulse = Math.sin(frame * 0.05) * 0.5 + 0.5;   // 0..1, fast
      const rim = Math.sin(frame * 0.02) * 0.5 + 0.5;     // 0..1, slow outer
      ctx.save();
      ctx.shadowColor = GLOW;
      ctx.shadowBlur = 20 + pulse * 18 + rim * 12;
      ctx.fillStyle = `rgba(0, 212, 255, ${0.18 + pulse * 0.22})`;
      drawPolygonPath(ctx, shield);
      ctx.fill();
      ctx.restore();
    }

    function drawStatic() {
      ctx.fillStyle = '#04060c';
      ctx.fillRect(0, 0, w, h);
      ctx.font = FONT_SIZE + 'px monospace';
      // sparse static rain
      for (let i = 0; i < columns; i++) {
        const ch = CHARS[(Math.random() * CHARS.length) | 0];
        ctx.fillStyle = 'rgba(0, 255, 157, 0.45)';
        ctx.fillText(ch, i * FONT_SIZE, (Math.random() * h) | 0);
      }
      // erase shield, steady cyan glow (no pulse for reduced motion)
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      drawPolygonPath(ctx, shield);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.shadowColor = GLOW;
      ctx.shadowBlur = 22;
      ctx.fillStyle = 'rgba(0, 212, 255, 0.32)';
      drawPolygonPath(ctx, shield);
      ctx.fill();
      ctx.restore();
    }

    let running = true;
    function tick() {
      if (!running) return;
      if (document.hidden) { requestAnimationFrame(tick); return; }
      frame++;
      if (reduced) drawStatic();
      else drawFrame();
      requestAnimationFrame(tick);
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    resize();
    requestAnimationFrame(tick);
    return { stop() { running = false; ro.disconnect(); } };
  }

  // Auto-mount public API
  window.NexVaultFX = {
    startShield,
    mountAll(root) {
      const els = (root || document).querySelectorAll('[data-nv-binary-shield]');
      return Array.from(els).map(startShield);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.NexVaultFX.mountAll());
  } else {
    window.NexVaultFX.mountAll();
  }
})();
