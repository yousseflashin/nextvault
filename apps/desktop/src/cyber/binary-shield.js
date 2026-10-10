/*
 * NexVault binary-shield animation.
 * Binary digits rain down and converge into a glowing shield outline.
 * Self-contained: attach a <canvas class="nv-canvas" data-nv-binary-shield></canvas>.
 */
(function () {
  'use strict';

  const CHARS = '01';
  const FONT_SIZE = 14;
  const RAIN_DPR_CAP = 2;

  function makeShieldTargets(width, height, count) {
    // Parametric shield outline + inner diamond, sampled into target points.
    const cx = width / 2, cy = height * 0.42;
    const w = Math.min(width, height) * 0.30;
    const h = w * 1.18;
    const pts = [];

    const outline = [];
    const seg = 60;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      // top edge (slightly arched)
      const x = cx - w / 2 + w * t;
      const y = cy - h / 2 + Math.sin(t * Math.PI) * -h * 0.06;
      outline.push([x, y]);
    }
    // right side curving to bottom point
    for (let i = 1; i <= seg; i++) {
      const t = i / seg;
      const x = cx + w / 2 - (w / 2) * Math.pow(t, 2.2);
      const y = cy - h / 2 + h * t;
      outline.push([x, y]);
    }
    // left side back up
    for (let i = 1; i <= seg; i++) {
      const t = i / seg;
      const x = cx - (w / 2) * Math.pow(1 - t, 2.2);
      const y = cy + h / 2 - h * t;
      outline.push([x, y]);
    }

    // inner diamond detail
    const r = w * 0.16;
    for (let i = 0; i <= 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      outline.push([cx + Math.abs(Math.cos(t)) * Math.cos(t) * r * 1.4,
                    cy + Math.abs(Math.sin(t)) * Math.sin(t) * r * 1.4 + h * 0.02]);
    }

    // sample to requested count
    for (let i = 0; i < count; i++) {
      const p = outline[Math.floor((i / count) * outline.length)];
      pts.push({ x: p[0], y: p[1] });
    }
    return pts;
  }

  function startShield(canvas) {
    const ctx = canvas.getContext('2d');
    let width, height, dpr;
    let columns, drops, speeds;
    let targets = null;
    let phase = 'rain';        // 'rain' -> 'converge' -> 'hold'
    let frame = 0;
    const CONVERGE_AT = 220;   // frames of pure rain before pulling to shield
    let particles = null;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, RAIN_DPR_CAP);
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = width * dpr; canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      columns = Math.max(8, Math.floor(width / FONT_SIZE));
      drops = Array.from({ length: columns }, () => Math.random() * -50);
      speeds = Array.from({ length: columns }, () => 0.35 + Math.random() * 0.65);
      targets = makeShieldTargets(width, height, columns * 2);
      particles = [];
    }

    function drawRain() {
      ctx.fillStyle = 'rgba(4, 6, 12, 0.16)';
      ctx.fillRect(0, 0, width, height);
      ctx.font = FONT_SIZE + 'px monospace';
      for (let i = 0; i < columns; i++) {
        const ch = CHARS[(Math.random() * CHARS.length) | 0];
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;
        ctx.fillStyle = Math.random() < 0.06 ? '#b6ffe0' : 'rgba(0, 255, 157, 0.75)';
        ctx.fillText(ch, x, y);
        drops[i] += speeds[i];
        if (y > height + FONT_SIZE * 4 && Math.random() > 0.96) drops[i] = Math.random() * -20;
      }
    }

    function spawnParticles() {
      for (let i = 0; i < columns; i++) {
        const tx = targets[(Math.random() * targets.length) | 0];
        particles.push({
          x: i * FONT_SIZE,
          y: Math.random() * height,
          tx: tx.x, ty: tx.y,
          vx: 0, vy: 0,
          ch: CHARS[(Math.random() * CHARS.length) | 0],
        });
      }
      // second wave for density
      for (let i = 0; i < columns; i++) {
        const tx = targets[(Math.random() * targets.length) | 0];
        particles.push({
          x: Math.random() * width,
          y: -20 - Math.random() * height * 0.5,
          tx: tx.x, ty: tx.y,
          vx: 0, vy: 0,
          ch: CHARS[(Math.random() * CHARS.length) | 0],
        });
      }
    }

    function drawConverge() {
      ctx.fillStyle = 'rgba(4, 6, 12, 0.22)';
      ctx.fillRect(0, 0, width, height);
      ctx.font = FONT_SIZE + 'px monospace';
      let settled = 0;
      for (const p of particles) {
        p.vx += (p.tx - p.x) * 0.02;
        p.vy += (p.ty - p.y) * 0.02;
        p.vx *= 0.86; p.vy *= 0.86;
        p.x += p.vx; p.y += p.vy;
        if (Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) < 3) settled++;
        // head digit brighter
        ctx.fillStyle = settled > particles.length * 0.7 ? '#8fffcf' : 'rgba(0,255,157,0.95)';
        ctx.fillText(p.ch, p.x, p.y);
      }
      return settled / particles.length;
    }

    function drawHold() {
      ctx.fillStyle = 'rgba(4, 6, 12, 0.1)';
      ctx.fillRect(0, 0, width, height);
      ctx.font = FONT_SIZE + 'px monospace';
      const t = Date.now() / 700;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        // twinkle a few digits
        const blink = ((i + ((t * 7) | 0)) % 17) === 0;
        if (blink) p.ch = CHARS[(Math.random() * CHARS.length) | 0];
        ctx.fillStyle = blink ? '#eafff5' : 'rgba(0,255,157,0.85)';
        ctx.fillText(p.ch, p.x, p.y);
      }
    }

    let running = true;
    function tick() {
      if (!running) return;
      if (document.hidden) { requestAnimationFrame(tick); return; }

      if (reduced) {
        // Static shield, no motion
        ctx.fillStyle = '#04060c'; ctx.fillRect(0, 0, width, height);
        ctx.font = FONT_SIZE + 'px monospace';
        for (const t of targets) {
          ctx.fillStyle = 'rgba(0,255,157,0.55)';
          ctx.fillText(CHARS[(Math.random() * 2) | 0], t.x, t.y);
        }
        return;
      }

      frame++;
      if (phase === 'rain') {
        drawRain();
        if (frame > CONVERGE_AT) { phase = 'converge'; spawnParticles(); ctx.clearRect(0, 0, width, height); }
      } else if (phase === 'converge') {
        const settled = drawConverge();
        if (settled > 0.985) { phase = 'hold'; ctx.clearRect(0, 0, width, height); }
      } else {
        drawHold();
      }
      requestAnimationFrame(tick);
    }

    const ro = new ResizeObserver(() => { const p = phase; resize(); phase = p; });
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
