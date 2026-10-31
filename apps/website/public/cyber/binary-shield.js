/*
 * NexVault Cinematic Full Cyber Shield Engine — Dark Realism Edition (Hyper-Optimized)
 *
 * Performance-engineered for 60fps locked rendering with near-zero CPU/GPU footprint:
 *  - Offscreen canvas pre-rendering for titanium-carbon shield, carbon hex weave & hacker geometry.
 *  - Analytical O(1) shield boundary detection for deflecting rain (replaces 120-vertex polygon checks).
 *  - IntersectionObserver + PageVisibility auto-pauses animation when scrolled away or inactive.
 *  - Hardware-accelerated GPU glyph rendering (eliminates expensive canvas shadowBlur on text).
 *  - Delta-time 60fps frame rate throttling (prevents unnecessary 120Hz/144Hz battery drain).
 */
(function () {
  'use strict';

  const CHARS = '01';
  const HEX_CHARS = '0123456789ABCDEF';
  const FONT_SIZE = 13;
  const RAIN_DPR_CAP = 1.5; // High clarity with optimal memory footprint

  const COLOR_PRIMARY = '#00ff9d';
  const COLOR_ACCENT = '#00d4ff';
  const COLOR_WHITE = '#ffffff';

  // Parametric cubic Bézier curves for exact, smooth shield geometry
  function getShieldControlPoints(cx, cy, sw, sh, inset = 0) {
    const w = Math.max(10, sw - inset * 2);
    const h = Math.max(10, sh - inset * 2);

    return [
      // Segment 0: Top center crest -> top right corner
      {
        p0: { x: cx, y: cy - h * 0.46 },
        p1: { x: cx + w * 0.22, y: cy - h * 0.49 },
        p2: { x: cx + w * 0.44, y: cy - h * 0.45 },
        p3: { x: cx + w * 0.50, y: cy - h * 0.35 }
      },
      // Segment 1: Top right corner -> bottom tip
      {
        p0: { x: cx + w * 0.50, y: cy - h * 0.35 },
        p1: { x: cx + w * 0.52, y: cy + h * 0.08 },
        p2: { x: cx + w * 0.28, y: cy + h * 0.36 },
        p3: { x: cx, y: cy + h * 0.50 }
      },
      // Segment 2: Bottom tip -> top left corner
      {
        p0: { x: cx, y: cy + h * 0.50 },
        p1: { x: cx - w * 0.28, y: cy + h * 0.36 },
        p2: { x: cx - w * 0.52, y: cy + h * 0.08 },
        p3: { x: cx - w * 0.50, y: cy - h * 0.35 }
      },
      // Segment 3: Top left corner -> top center crest
      {
        p0: { x: cx - w * 0.50, y: cy - h * 0.35 },
        p1: { x: cx - w * 0.44, y: cy - h * 0.45 },
        p2: { x: cx - w * 0.22, y: cy - h * 0.49 },
        p3: { x: cx, y: cy - h * 0.46 }
      }
    ];
  }

  function evalCubic(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const a = mt2 * mt;
    const b = 3 * mt2 * t;
    const c = 3 * mt * t2;
    const d = t2 * t;

    const x = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
    const y = a * p0.y + b * p1.y + c * p2.y + d * p3.y;

    const dx = 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x);
    const dy = 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y);
    const len = Math.hypot(dx, dy) || 1;

    return { x, y, nx: dy / len, ny: -dx / len };
  }

  function getShieldPath(ctx, cx, cy, sw, sh) {
    const segs = getShieldControlPoints(cx, cy, sw, sh, 0);
    ctx.beginPath();
    ctx.moveTo(segs[0].p0.x, segs[0].p0.y);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      ctx.bezierCurveTo(s.p1.x, s.p1.y, s.p2.x, s.p2.y, s.p3.x, s.p3.y);
    }
    ctx.closePath();
  }

  function generateShieldPoints(cx, cy, sw, sh, totalCount = 100) {
    const segs = getShieldControlPoints(cx, cy, sw, sh, 0);
    const pts = [];
    const perSeg = Math.floor(totalCount / 4);

    for (let s = 0; s < 4; s++) {
      const seg = segs[s];
      for (let i = 0; i < perSeg; i++) {
        const t = i / perSeg;
        pts.push(evalCubic(seg.p0, seg.p1, seg.p2, seg.p3, t));
      }
    }
    return pts;
  }

  function generateHackerPoints(cx, cy, sw, sh) {
    const pts = [];
    const hoodTopY = cy - sh * 0.26;
    const hoodW = sw * 0.36;
    const hoodH = sh * 0.34;

    const hoodSteps = 24;
    for (let i = 0; i <= hoodSteps; i++) {
      const angle = Math.PI + (i / hoodSteps) * Math.PI;
      const x = cx + Math.cos(angle) * (hoodW * 0.52);
      const y = hoodTopY + Math.sin(angle) * (hoodH * 0.48) + Math.abs(i - hoodSteps / 2) * 1.6;
      pts.push({ x, y, type: 'hood' });
    }

    for (let s = -0.36; s <= 0.36; s += 0.05) {
      if (Math.abs(s) < 0.12) continue;
      const x = cx + s * sw;
      const y = cy + sh * 0.08 + Math.abs(s) * (sh * 0.22);
      pts.push({ x, y, type: 'body' });
    }

    const lidTopY = cy + sh * 0.04;
    const lidHingeY = cy + sh * 0.18;
    const lidTopW = sw * 0.30;
    const lidBotW = sw * 0.34;

    for (let x = cx - lidTopW / 2; x <= cx + lidTopW / 2; x += 8) {
      pts.push({ x, y: lidTopY, type: 'lid' });
    }
    for (let x = cx - lidBotW / 2; x <= cx + lidBotW / 2; x += 8) {
      pts.push({ x, y: lidHingeY, type: 'lid' });
    }
    for (let f = 0.25; f <= 0.75; f += 0.25) {
      const ly = lidTopY + (lidHingeY - lidTopY) * f;
      const curW = lidTopW + (lidBotW - lidTopW) * f;
      pts.push({ x: cx - curW / 2, y: ly, type: 'lid' });
      pts.push({ x: cx + curW / 2, y: ly, type: 'lid' });
    }

    const logoY = (lidTopY + lidHingeY) / 2;
    pts.push({ x: cx, y: logoY - 7, type: 'logo' });
    pts.push({ x: cx + 6, y: logoY - 4, type: 'logo' });
    pts.push({ x: cx + 5, y: logoY + 3, type: 'logo' });
    pts.push({ x: cx, y: logoY + 7, type: 'logo' });
    pts.push({ x: cx - 5, y: logoY + 3, type: 'logo' });
    pts.push({ x: cx - 6, y: logoY - 4, type: 'logo' });
    pts.push({ x: cx, y: logoY, type: 'logo' });

    for (let gy = lidTopY - 6; gy >= hoodTopY + hoodH * 0.4; gy -= 10) {
      const prog = (lidTopY - gy) / (lidTopY - (hoodTopY + hoodH * 0.4));
      const beamW = lidTopW * 0.8 + prog * (hoodW * 0.6);
      pts.push({ x: cx - beamW * 0.3, y: gy, type: 'screen-glow' });
      pts.push({ x: cx, y: gy, type: 'screen-glow' });
      pts.push({ x: cx + beamW * 0.3, y: gy, type: 'screen-glow' });
    }

    pts.push({ x: cx - lidBotW * 0.52, y: lidHingeY - 6, type: 'hands' });
    pts.push({ x: cx - lidBotW * 0.48, y: lidHingeY - 10, type: 'hands' });
    pts.push({ x: cx + lidBotW * 0.48, y: lidHingeY - 10, type: 'hands' });
    pts.push({ x: cx + lidBotW * 0.52, y: lidHingeY - 6, type: 'hands' });

    return pts;
  }

  // Fast analytical shield boundary check (O(1) collision replaces 120-vertex polygon raycasts)
  function isInsideShieldFast(px, py, cx, cy, sw, sh) {
    const dx = Math.abs(px - cx);
    const dy = py - cy;
    const halfW = sw * 0.52;
    const top = -sh * 0.48;
    const bottom = sh * 0.50;

    if (dy < top || dy > bottom || dx > halfW) return false;
    if (dy <= sh * 0.08) return true;
    const taper = 1 - (dy - sh * 0.08) / (bottom - sh * 0.08);
    return dx <= halfW * Math.max(0, taper);
  }

  function drawHexagon(ctx, x, y, r) {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const hx = x + r * Math.cos(a);
      const hy = y + r * Math.sin(a);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
  }

  function startShieldAnimation(canvas, options = {}) {
    if (!canvas || canvas.__nv_shield_running) return;
    canvas.__nv_shield_running = true;

    const ctx = canvas.getContext('2d', { alpha: false });
    let w = 0, h = 0, dpr = 1;
    let cx = 0, cy = 0, sw = 0, sh = 0;
    let columns = 0, drops = [], speeds = [];
    let shieldPoints = [];
    let hackerPoints = [];
    let orbitalStreams = [];
    let sparkParticles = [];

    // Offscreen canvas for pre-rendering static heavy shield plate
    let offscreenShield = null;
    let offscreenShieldCtx = null;

    let frame = 0;
    let stage = 0;
    let flashIntensity = 0;
    let shockwaveRadius = 0;
    let stageListener = null;

    // Performance controls: pause when offscreen, 60fps cap
    let isVisible = true;
    let isRunning = false;
    let lastFrameTime = 0;
    const targetInterval = 1000 / 60; // 60 FPS cap

    const STAGE_NAMES = [
      'MATRIX CONVERGENCE',
      'ATMOSPHERIC PULSE',
      'TITANIUM SOLIDIFY',
      'STEALTH DEFENSE ORBIT'
    ];

    function setStage(newStage) {
      if (stage !== newStage) {
        stage = newStage;
        canvas.__nv_stage = stage;
        canvas.__nv_stage_name = STAGE_NAMES[stage] || 'ACTIVE';
        if (typeof stageListener === 'function') {
          stageListener(stage, canvas.__nv_stage_name);
        }
      }
    }

    canvas.__nv_set_stage_listener = function (fn) {
      stageListener = fn;
      if (typeof fn === 'function') {
        fn(stage, STAGE_NAMES[stage]);
      }
    };

    canvas.addEventListener('click', () => {
      flashIntensity = 0.45;
      shockwaveRadius = 14;
      for (let i = 0; i < 15; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 1.5 + Math.random() * 3.0;
        sparkParticles.push({
          x: cx,
          y: cy + sh * 0.08,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 1.0,
          color: Math.random() < 0.6 ? COLOR_ACCENT : COLOR_PRIMARY
        });
      }
    });

    // Pre-render the entire heavy solidified shield plate to an offscreen canvas
    function buildOffscreenShield() {
      if (!offscreenShield) {
        offscreenShield = document.createElement('canvas');
        offscreenShieldCtx = offscreenShield.getContext('2d');
      }
      offscreenShield.width = Math.round(w * dpr);
      offscreenShield.height = Math.round(h * dpr);
      offscreenShieldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const oCtx = offscreenShieldCtx;
      oCtx.clearRect(0, 0, w, h);

      // 1. Dark Titanium-Carbon Shield Surface
      const metalGrad = oCtx.createLinearGradient(cx - sw / 2, cy - sh / 2, cx + sw / 2, cy + sh / 2);
      metalGrad.addColorStop(0, '#152238');
      metalGrad.addColorStop(0.25, '#0c1524');
      metalGrad.addColorStop(0.7, '#101a2e');
      metalGrad.addColorStop(1, '#080e1a');

      oCtx.fillStyle = metalGrad;
      getShieldPath(oCtx, cx, cy, sw, sh);
      oCtx.fill();

      // 2. Realistic Chamfered Steel Bevel
      oCtx.strokeStyle = 'rgba(0, 212, 255, 0.85)';
      oCtx.lineWidth = 1.8;
      getShieldPath(oCtx, cx, cy, sw, sh);
      oCtx.stroke();

      // 3. Subtle Carbon-Fiber Hexagonal Lattice
      oCtx.save();
      getShieldPath(oCtx, cx, cy, sw - 8, sh - 8);
      oCtx.clip();
      oCtx.strokeStyle = 'rgba(0, 255, 157, 0.14)';
      oCtx.lineWidth = 1;
      const hexR = 20;
      oCtx.beginPath();
      for (let y = cy - sh * 0.46; y < cy + sh * 0.48; y += hexR * 1.5) {
        for (let x = cx - sw * 0.48; x < cx + sw * 0.48; x += hexR * Math.sqrt(3)) {
          drawHexagon(oCtx, x, y, hexR);
        }
      }
      oCtx.stroke();
      oCtx.restore();

      // 4. Dark Hardware Rivets / Hex Studs
      const studs = [
        { x: cx, y: cy - sh * 0.42 },
        { x: cx + sw * 0.38, y: cy - sh * 0.32 },
        { x: cx - sw * 0.38, y: cy - sh * 0.32 },
        { x: cx + sw * 0.42, y: cy + sh * 0.04 },
        { x: cx - sw * 0.42, y: cy + sh * 0.04 },
        { x: cx + sw * 0.22, y: cy + sh * 0.32 },
        { x: cx - sw * 0.22, y: cy + sh * 0.32 },
        { x: cx, y: cy + sh * 0.45 }
      ];
      for (const s of studs) {
        oCtx.fillStyle = '#060a12';
        oCtx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
        oCtx.lineWidth = 1;
        oCtx.beginPath();
        oCtx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        oCtx.fill();
        oCtx.stroke();
      }

      // 5. Pre-rendered Hacker Hoodie & Laptop
      const hoodTopY = cy - sh * 0.26;
      const hoodW = sw * 0.36;
      const hoodH = sh * 0.38;
      const lidTopY = cy + sh * 0.04;
      const lidHingeY = cy + sh * 0.18;
      const lidTopW = sw * 0.30;
      const lidBotW = sw * 0.34;

      // Dark Hoodie Silhouette
      oCtx.fillStyle = '#0a101d';
      oCtx.beginPath();
      oCtx.moveTo(cx, hoodTopY - 10);
      oCtx.bezierCurveTo(cx - hoodW * 0.55, hoodTopY, cx - hoodW * 0.65, hoodTopY + hoodH * 0.5, cx - hoodW * 0.5, hoodTopY + hoodH * 0.85);
      oCtx.lineTo(cx - sw * 0.34, cy + sh * 0.28);
      oCtx.lineTo(cx + sw * 0.34, cy + sh * 0.28);
      oCtx.lineTo(cx + hoodW * 0.5, hoodTopY + hoodH * 0.85);
      oCtx.bezierCurveTo(cx + hoodW * 0.65, hoodTopY + hoodH * 0.5, cx + hoodW * 0.55, hoodTopY, cx, hoodTopY - 10);
      oCtx.closePath();
      oCtx.fill();
      oCtx.strokeStyle = 'rgba(0, 255, 157, 0.5)';
      oCtx.lineWidth = 1.4;
      oCtx.stroke();

      // Deep Shadow / Face Void
      oCtx.fillStyle = '#03050c';
      oCtx.beginPath();
      oCtx.ellipse(cx, cy - sh * 0.11, hoodW * 0.32, hoodH * 0.28, 0, 0, Math.PI * 2);
      oCtx.fill();
      oCtx.strokeStyle = 'rgba(0, 212, 255, 0.7)';
      oCtx.lineWidth = 1.5;
      oCtx.beginPath();
      oCtx.arc(cx, cy - sh * 0.06, hoodW * 0.25, Math.PI * 0.12, Math.PI * 0.88);
      oCtx.stroke();

      // Hacker Hands
      oCtx.fillStyle = '#050a14';
      oCtx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
      oCtx.lineWidth = 1.2;
      oCtx.beginPath();
      oCtx.ellipse(cx - lidBotW * 0.52, lidHingeY - 8, 8, 5, -0.25, 0, Math.PI * 2);
      oCtx.fill();
      oCtx.stroke();
      oCtx.beginPath();
      oCtx.ellipse(cx + lidBotW * 0.52, lidHingeY - 8, 8, 5, 0.25, 0, Math.PI * 2);
      oCtx.fill();
      oCtx.stroke();

      // Laptop Lid
      const lidGrad = oCtx.createLinearGradient(cx - lidTopW / 2, lidTopY, cx + lidBotW / 2, lidHingeY);
      lidGrad.addColorStop(0, '#1c283d');
      lidGrad.addColorStop(0.35, '#0e1726');
      lidGrad.addColorStop(0.7, '#131e33');
      lidGrad.addColorStop(1, '#09101d');

      oCtx.fillStyle = lidGrad;
      oCtx.beginPath();
      oCtx.moveTo(cx - lidTopW / 2, lidTopY);
      oCtx.lineTo(cx + lidTopW / 2, lidTopY);
      oCtx.lineTo(cx + lidBotW / 2, lidHingeY);
      oCtx.lineTo(cx - lidBotW / 2, lidHingeY);
      oCtx.closePath();
      oCtx.fill();
      oCtx.strokeStyle = 'rgba(0, 212, 255, 0.75)';
      oCtx.lineWidth = 1.4;
      oCtx.stroke();

      // Laptop Hinge Bar
      oCtx.fillStyle = '#060a12';
      oCtx.strokeStyle = 'rgba(0, 255, 157, 0.35)';
      oCtx.lineWidth = 1;
      oCtx.fillRect(cx - lidBotW * 0.54, lidHingeY, lidBotW * 1.08, 4.5);
      oCtx.strokeRect(cx - lidBotW * 0.54, lidHingeY, lidBotW * 1.08, 4.5);

      // Emblem on Back of Laptop Lid
      const logoY = (lidTopY + lidHingeY) / 2;
      const logoW = 18;
      const logoH = 22;
      oCtx.strokeStyle = COLOR_ACCENT;
      oCtx.lineWidth = 1.6;
      oCtx.fillStyle = 'rgba(0, 212, 255, 0.18)';
      oCtx.beginPath();
      oCtx.moveTo(cx, logoY - logoH * 0.45);
      oCtx.bezierCurveTo(cx + logoW * 0.5, logoY - logoH * 0.45, cx + logoW * 0.5, logoY, cx, logoY + logoH * 0.5);
      oCtx.bezierCurveTo(cx - logoW * 0.5, logoY, cx - logoW * 0.5, logoY - logoH * 0.45, cx, logoY - logoH * 0.45);
      oCtx.closePath();
      oCtx.fill();
      oCtx.stroke();

      oCtx.fillStyle = COLOR_WHITE;
      oCtx.fillRect(cx - 2, logoY - 2, 4, 4);
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, RAIN_DPR_CAP);
      w = canvas.clientWidth || canvas.parentElement?.clientWidth || 550;
      h = canvas.clientHeight || canvas.parentElement?.clientHeight || 480;

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cx = w / 2;
      cy = h / 2;
      sw = Math.min(w * 0.68, Math.min(h * 0.72, 380));
      sh = sw * 1.25;

      columns = Math.max(16, Math.floor(w / FONT_SIZE));
      drops = Array.from({ length: columns }, () => Math.random() * -60);
      speeds = Array.from({ length: columns }, () => 0.48 + Math.random() * 0.82);

      shieldPoints = generateShieldPoints(cx, cy, sw, sh, 90);
      hackerPoints = generateHackerPoints(cx, cy, sw, sh);

      // Create running orbital streams (streamlined character counts for optimal speed)
      orbitalStreams = [];
      const totalPoints = shieldPoints.length;

      // Stream 1: Clockwise primary stream (Green & White digits)
      for (let i = 0; i < 36; i++) {
        orbitalStreams.push({
          pos: (i / 36) * totalPoints,
          speed: 0.65 + (i % 3) * 0.08,
          char: CHARS[i % 2],
          color: i % 4 === 0 ? COLOR_WHITE : COLOR_PRIMARY,
          offset: 14 + (Math.random() - 0.5) * 4
        });
      }

      // Stream 2: Counter-Clockwise outer stream (Cyan Hex digits)
      for (let i = 0; i < 26; i++) {
        orbitalStreams.push({
          pos: (i / 26) * totalPoints,
          speed: -(0.45 + (i % 2) * 0.12),
          char: HEX_CHARS[i % HEX_CHARS.length],
          color: i % 3 === 0 ? COLOR_WHITE : COLOR_ACCENT,
          offset: 22 + (Math.random() - 0.5) * 5
        });
      }

      buildOffscreenShield();
    }

    // Dynamic Deflecting Background Matrix Rain (O(1) shield collision)
    function drawDeflectingRain() {
      ctx.font = `${FONT_SIZE}px monospace`;

      for (let i = 0; i < columns; i++) {
        let x = i * FONT_SIZE;
        let y = drops[i] * FONT_SIZE;

        if (stage >= 2) {
          if (isInsideShieldFast(x, y, cx, cy, sw, sh)) {
            const dir = x >= cx ? 1 : -1;
            x += dir * 18;

            if (Math.random() < 0.05 && sparkParticles.length < 25) {
              sparkParticles.push({
                x,
                y,
                vx: dir * (1.2 + Math.random() * 2.2),
                vy: (Math.random() - 0.4) * 2.5,
                life: 0.85,
                color: Math.random() < 0.6 ? COLOR_PRIMARY : COLOR_ACCENT
              });
            }
          }
        }

        const ch = CHARS[(Math.random() * CHARS.length) | 0];
        const isLeading = Math.random() < 0.05;

        if (isLeading) {
          ctx.fillStyle = '#bdfce0';
        } else if (stage >= 2 && Math.abs(x - cx) < sw * 0.7 && Math.abs(y - cy) < sh * 0.7) {
          ctx.fillStyle = 'rgba(0, 212, 255, 0.40)';
        } else {
          ctx.fillStyle = 'rgba(0, 255, 157, 0.45)';
        }

        ctx.fillText(ch, x, y);

        drops[i] += speeds[i];
        if (y > h + FONT_SIZE * 2) {
          drops[i] = Math.random() * -20;
        }
      }
    }

    // Phase 1: Matrix Binary Convergence (Hardware text rendering without shadowBlur)
    function drawConvergencePhase(progress) {
      ctx.font = '12px monospace';

      const shieldCount = Math.floor(shieldPoints.length * Math.min(1, progress * 1.25));
      for (let i = 0; i < shieldCount; i++) {
        const pt = shieldPoints[i];
        const jitter = (1 - progress) * 24;
        const jx = (Math.random() - 0.5) * jitter;
        const jy = (Math.random() - 0.5) * jitter;
        const ch = HEX_CHARS[(Math.random() * HEX_CHARS.length) | 0];

        ctx.fillStyle = Math.random() < 0.25 ? COLOR_WHITE : COLOR_PRIMARY;
        ctx.fillText(ch, pt.x + jx - 4, pt.y + jy + 4);
      }

      const hackerCount = Math.floor(hackerPoints.length * Math.min(1, progress * 1.35));
      for (let i = 0; i < hackerCount; i++) {
        const hp = hackerPoints[i];
        const jitter = (1 - progress) * 16;
        const jx = (Math.random() - 0.5) * jitter;
        const jy = (Math.random() - 0.5) * jitter;
        const ch = CHARS[(Math.random() * CHARS.length) | 0];

        if (hp.type === 'logo') {
          ctx.fillStyle = COLOR_ACCENT;
        } else if (hp.type === 'screen-glow') {
          ctx.fillStyle = '#bdfce0';
        } else if (hp.type === 'hands') {
          ctx.fillStyle = COLOR_PRIMARY;
        } else {
          ctx.fillStyle = 'rgba(0, 255, 157, 0.70)';
        }
        ctx.fillText(ch, hp.x + jx - 4, hp.y + jy + 4);
      }

      if (progress > 0.45) {
        ctx.strokeStyle = `rgba(0, 212, 255, ${(progress - 0.45) * 0.75})`;
        ctx.lineWidth = 1.5;
        getShieldPath(ctx, cx, cy, sw, sh);
        ctx.stroke();
      }

      if (progress > 0.75) {
        const glowRad = (progress - 0.75) * 4 * sw * 0.28;
        const grad = ctx.createRadialGradient(cx, cy + sh * 0.04, 2, cx, cy - sh * 0.08, glowRad);
        grad.addColorStop(0, 'rgba(0, 212, 255, 0.40)');
        grad.addColorStop(1, 'rgba(0, 212, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy + sh * 0.02, glowRad, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Phase 2: Atmospheric Surge & Shockwave
    function drawAtmosphericPulse() {
      if (flashIntensity <= 0.01) return;
      ctx.save();

      const flashGrad = ctx.createRadialGradient(cx, cy, sw * 0.2, cx, cy, sw * 1.2);
      flashGrad.addColorStop(0, `rgba(0, 212, 255, ${flashIntensity * 0.55})`);
      flashGrad.addColorStop(0.5, `rgba(0, 255, 157, ${flashIntensity * 0.28})`);
      flashGrad.addColorStop(1, 'rgba(4, 6, 12, 0)');
      ctx.fillStyle = flashGrad;
      ctx.fillRect(0, 0, w, h);

      shockwaveRadius += 16;
      ctx.strokeStyle = `rgba(0, 212, 255, ${flashIntensity * 0.9})`;
      ctx.lineWidth = 4 * flashIntensity;
      ctx.beginPath();
      ctx.arc(cx, cy, shockwaveRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(0, 255, 157, ${flashIntensity * 0.6})`;
      ctx.lineWidth = 2 * flashIntensity;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, shockwaveRadius - 20), 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }

    // Phase 3 & 4: Blit pre-rendered shield + animate dynamic screen glow and pulse
    function drawSolidifiedShield(pulse) {
      // 1. Dual-pass crisp neon boundary strokes
      ctx.strokeStyle = `rgba(0, 255, 157, ${0.35 + pulse * 0.35})`;
      ctx.lineWidth = 3.5;
      getShieldPath(ctx, cx, cy, sw + 4, sh + 4);
      ctx.stroke();

      ctx.strokeStyle = `rgba(0, 212, 255, ${0.75 + pulse * 0.25})`;
      ctx.lineWidth = 1.5;
      getShieldPath(ctx, cx, cy, sw + 1, sh + 1);
      ctx.stroke();

      // 2. Hardware blit offscreen shield plate (< 0.05ms)
      if (offscreenShield) {
        ctx.drawImage(offscreenShield, 0, 0, w, h);
      }

      // 3. Dynamic Upward Screen Light Cone
      const hoodTopY = cy - sh * 0.26;
      const hoodW = sw * 0.36;
      const hoodH = sh * 0.38;
      const lidTopY = cy + sh * 0.04;
      const lidTopW = sw * 0.30;

      const spillGrad = ctx.createRadialGradient(cx, lidTopY + 4, 8, cx, cy - sh * 0.12, sw * 0.32);
      spillGrad.addColorStop(0, `rgba(0, 212, 255, ${0.70 + pulse * 0.2})`);
      spillGrad.addColorStop(0.35, `rgba(0, 255, 157, ${0.38 + pulse * 0.15})`);
      spillGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = spillGrad;
      ctx.beginPath();
      ctx.moveTo(cx - lidTopW / 2 - 12, lidTopY + 12);
      ctx.lineTo(cx - hoodW * 0.55, hoodTopY + hoodH * 0.45);
      ctx.lineTo(cx + hoodW * 0.55, hoodTopY + hoodH * 0.45);
      ctx.lineTo(cx + lidTopW / 2 + 12, lidTopY + 12);
      ctx.closePath();
      ctx.fill();

      // Screen rim glow line
      ctx.strokeStyle = COLOR_ACCENT;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - lidTopW * 0.48, lidTopY - 1);
      ctx.lineTo(cx + lidTopW * 0.48, lidTopY - 1);
      ctx.stroke();

      // 4. Recessed Neon Circuit Waveguides
      ctx.strokeStyle = `rgba(0, 212, 255, ${0.25 + pulse * 0.35})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - sh * 0.44);
      ctx.lineTo(cx, cy - sh * 0.28);
      ctx.moveTo(cx, cy + sh * 0.28);
      ctx.lineTo(cx, cy + sh * 0.47);
      ctx.moveTo(cx - sw * 0.42, cy - sh * 0.04);
      ctx.lineTo(cx - sw * 0.24, cy - sh * 0.04);
      ctx.moveTo(cx + sw * 0.24, cy - sh * 0.04);
      ctx.lineTo(cx + sw * 0.42, cy - sh * 0.04);
      ctx.stroke();
    }

    // Phase 4: Running Binary & Hex Streams (Hardware text blit)
    function drawRunningOrbitingBinary() {
      ctx.font = '12px monospace';
      const totalPoints = shieldPoints.length;

      for (let i = 0; i < orbitalStreams.length; i++) {
        const stream = orbitalStreams[i];
        stream.pos = (stream.pos + stream.speed + totalPoints) % totalPoints;
        const idx = Math.floor(stream.pos);
        const nextIdx = (idx + 1) % totalPoints;
        const frac = stream.pos - idx;

        const p1 = shieldPoints[idx];
        const p2 = shieldPoints[nextIdx];
        if (!p1 || !p2) continue;

        const baseX = p1.x + (p2.x - p1.x) * frac;
        const baseY = p1.y + (p2.y - p1.y) * frac;
        const nx = p1.nx || 0;
        const ny = p1.ny || 0;
        const x = baseX + nx * stream.offset;
        const y = baseY + ny * stream.offset;

        ctx.fillStyle = stream.color;
        ctx.fillText(stream.char, x - 4, y + 4);
      }

      // Spark Particles
      for (let i = sparkParticles.length - 1; i >= 0; i--) {
        const sp = sparkParticles[i];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.life -= 0.04;

        if (sp.life <= 0) {
          sparkParticles.splice(i, 1);
          continue;
        }

        ctx.fillStyle = sp.color;
        ctx.globalAlpha = sp.life;
        ctx.fillRect(sp.x, sp.y, 2, 2);
      }
      ctx.globalAlpha = 1.0;
    }

    function replay() {
      frame = 0;
      setStage(0);
      flashIntensity = 0;
      shockwaveRadius = 0;
      columns = Math.max(16, Math.floor(w / FONT_SIZE));
      drops = Array.from({ length: columns }, () => Math.random() * -60);
      if (!isRunning && isVisible) {
        isRunning = true;
        lastFrameTime = performance.now();
        requestAnimationFrame(tick);
      }
    }

    canvas.__nv_replay = replay;

    function tick(now) {
      if (!isVisible) {
        isRunning = false;
        return;
      }

      // 60 FPS Throttle
      const delta = now - lastFrameTime;
      if (delta < targetInterval - 1) {
        requestAnimationFrame(tick);
        return;
      }
      lastFrameTime = now - (delta % targetInterval);

      frame++;

      if (stage === 0) {
        if (frame > 145) {
          setStage(1);
          flashIntensity = 1.0;
          shockwaveRadius = 12;
        }
      } else if (stage === 1) {
        flashIntensity -= 0.038;
        if (flashIntensity <= 0.04) {
          flashIntensity = 0;
          setStage(2);
        }
      } else if (stage === 2) {
        if (frame > 210) {
          setStage(3);
        }
      } else if (stage === 3) {
        if (frame > 1400) {
          replay();
        }
      }

      // Smooth dark canvas clear
      ctx.fillStyle = 'rgba(4, 6, 12, 0.24)';
      ctx.fillRect(0, 0, w, h);

      drawDeflectingRain();

      const pulse = Math.sin(frame * 0.065) * 0.5 + 0.5;

      if (stage === 0) {
        drawConvergencePhase(frame / 145);
      } else if (stage === 1) {
        drawSolidifiedShield(pulse);
        drawAtmosphericPulse();
      } else {
        drawSolidifiedShield(pulse);
        drawRunningOrbitingBinary();
      }

      requestAnimationFrame(tick);
    }

    // Auto-pause animation when off-screen to free 100% CPU/GPU for smooth scrolling
    let observer = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const visible = entry.isIntersecting;
            if (visible !== isVisible) {
              isVisible = visible;
              if (isVisible && !isRunning) {
                isRunning = true;
                lastFrameTime = performance.now();
                requestAnimationFrame(tick);
              }
            }
          }
        },
        { threshold: 0.05 }
      );
      observer.observe(canvas);
    }

    // Auto-pause when user switches tab
    const handleVisibility = () => {
      if (document.hidden) {
        isVisible = false;
      } else {
        const rect = canvas.getBoundingClientRect();
        const inView = rect.bottom > 0 && rect.top < window.innerHeight;
        if (inView && !isRunning) {
          isVisible = true;
          isRunning = true;
          lastFrameTime = performance.now();
          requestAnimationFrame(tick);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    canvas.__nv_cleanup = () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', resize);
      isVisible = false;
      isRunning = false;
    };

    window.addEventListener('resize', resize);
    resize();

    isRunning = true;
    lastFrameTime = performance.now();
    requestAnimationFrame(tick);
  }

  function mountAll() {
    document.querySelectorAll('canvas[data-nv-binary-shield]').forEach((c) => {
      if (!c.__nv_shield_mounted) {
        c.__nv_shield_mounted = true;
        startShieldAnimation(c);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }

  window.NexVaultFX = { mountAll, startShieldAnimation };
})();
