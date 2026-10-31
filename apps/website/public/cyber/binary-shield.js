/*
 * NexVault Cinematic Full Cyber Shield Engine — Dark Realism Edition
 *
 * Sequence:
 *  1. [CONVERGE]: Matrix binary rain cascades and crystallizes into a full medieval-cyber shield.
 *     Inside the shield, a deep-shadow hooded hacker sits behind an open laptop facing him.
 *     The viewer sees the back of the laptop lid with an illuminated cyber emblem, while the
 *     screen beams intense cybernetic light upwards into the hacker's dark, faceless hood.
 *  2. [ATMOSPHERIC PULSE]: The laptop screen overcharges, radiating an upward cone of light
 *     and a sleek neon shockwave across the shield contour (clean atmospheric pulse, no lightning).
 *  3. [SOLIDIFY]: The shield solidifies into a realistic dark titanium-carbon armor plate with
 *     chamfered steel bevels, subtle carbon weave, and the embossed hacker behind the laptop.
 *  4. [STEALTH RUNNING]: Precision binary/hex streams continuously orbit the shield perimeter,
 *     with realistic spark deflection physics and interactive forcefield ripples.
 */
(function () {
  'use strict';

  const CHARS = '01';
  const HEX_CHARS = '0123456789ABCDEF';
  const FONT_SIZE = 13;
  const RAIN_DPR_CAP = 2;

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

    // Outward surface normal
    return { x, y, nx: dy / len, ny: -dx / len };
  }

  // Draw smooth shield perimeter path
  function getShieldPath(ctx, cx, cy, sw, sh, inset = 0) {
    const segs = getShieldControlPoints(cx, cy, sw, sh, inset);
    ctx.beginPath();
    ctx.moveTo(segs[0].p0.x, segs[0].p0.y);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      ctx.bezierCurveTo(s.p1.x, s.p1.y, s.p2.x, s.p2.y, s.p3.x, s.p3.y);
    }
    ctx.closePath();
  }

  // Generate evenly spaced anchor points along the shield contour
  function generateShieldPoints(cx, cy, sw, sh, totalCount = 120) {
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

  // Generate hacker points: Hood silhouette (no face), open laptop FACING the hacker (back of lid facing viewer)
  function generateHackerPoints(cx, cy, sw, sh) {
    const pts = [];
    const hoodTopY = cy - sh * 0.26;
    const hoodW = sw * 0.36;
    const hoodH = sh * 0.34;

    // 1. Hood cowl perimeter (deep shadow void inside, no face features)
    const hoodSteps = 28;
    for (let i = 0; i <= hoodSteps; i++) {
      const angle = Math.PI + (i / hoodSteps) * Math.PI;
      const x = cx + Math.cos(angle) * (hoodW * 0.52);
      const y = hoodTopY + Math.sin(angle) * (hoodH * 0.48) + Math.abs(i - hoodSteps / 2) * 1.6;
      pts.push({ x, y, type: 'hood' });
    }

    // 2. Hunched shoulders and arms reaching around the laptop
    for (let s = -0.36; s <= 0.36; s += 0.04) {
      if (Math.abs(s) < 0.12) continue;
      const x = cx + s * sw;
      const y = cy + sh * 0.08 + Math.abs(s) * (sh * 0.22);
      pts.push({ x, y, type: 'body' });
    }

    // 3. Laptop Lid (Back of display facing viewer, screen facing hacker)
    const lidTopY = cy + sh * 0.04;
    const lidHingeY = cy + sh * 0.18;
    const lidTopW = sw * 0.30;
    const lidBotW = sw * 0.34;

    // Lid top edge
    for (let x = cx - lidTopW / 2; x <= cx + lidTopW / 2; x += 7) {
      pts.push({ x, y: lidTopY, type: 'lid' });
    }
    // Lid bottom hinge
    for (let x = cx - lidBotW / 2; x <= cx + lidBotW / 2; x += 7) {
      pts.push({ x, y: lidHingeY, type: 'lid' });
    }
    // Lid left and right edges
    for (let f = 0.2; f <= 0.8; f += 0.2) {
      const ly = lidTopY + (lidHingeY - lidTopY) * f;
      const curW = lidTopW + (lidBotW - lidTopW) * f;
      pts.push({ x: cx - curW / 2, y: ly, type: 'lid' });
      pts.push({ x: cx + curW / 2, y: ly, type: 'lid' });
    }

    // 4. Illuminated Cyber Shield Emblem on the back of the laptop lid
    const logoY = (lidTopY + lidHingeY) / 2;
    pts.push({ x: cx, y: logoY - 7, type: 'logo' });
    pts.push({ x: cx + 6, y: logoY - 4, type: 'logo' });
    pts.push({ x: cx + 5, y: logoY + 3, type: 'logo' });
    pts.push({ x: cx, y: logoY + 7, type: 'logo' });
    pts.push({ x: cx - 5, y: logoY + 3, type: 'logo' });
    pts.push({ x: cx - 6, y: logoY - 4, type: 'logo' });
    pts.push({ x: cx, y: logoY, type: 'logo' }); // Center node

    // 5. Upward screen light beam (radiating from behind the lid up into the hood)
    for (let gy = lidTopY - 6; gy >= hoodTopY + hoodH * 0.4; gy -= 8) {
      const prog = (lidTopY - gy) / (lidTopY - (hoodTopY + hoodH * 0.4));
      const beamW = lidTopW * 0.8 + prog * (hoodW * 0.6);
      pts.push({ x: cx - beamW * 0.3, y: gy, type: 'screen-glow' });
      pts.push({ x: cx, y: gy, type: 'screen-glow' });
      pts.push({ x: cx + beamW * 0.3, y: gy, type: 'screen-glow' });
    }

    // 6. Hacker's hands reaching around the laptop lid to type on the keyboard behind it
    pts.push({ x: cx - lidBotW * 0.52, y: lidHingeY - 6, type: 'hands' });
    pts.push({ x: cx - lidBotW * 0.48, y: lidHingeY - 10, type: 'hands' });
    pts.push({ x: cx + lidBotW * 0.48, y: lidHingeY - 10, type: 'hands' });
    pts.push({ x: cx + lidBotW * 0.52, y: lidHingeY - 6, type: 'hands' });

    return pts;
  }

  // Point-in-polygon test for forcefield deflection
  function isPointInsidePolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y;
      const xj = pts[j].x, yj = pts[j].y;
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function startShieldAnimation(canvas, options = {}) {
    if (!canvas || canvas.__nv_shield_running) return;
    canvas.__nv_shield_running = true;

    const ctx = canvas.getContext('2d');
    let w, h, dpr;
    let cx, cy, sw, sh;
    let columns, drops, speeds;
    let shieldPoints = [];
    let hackerPoints = [];
    let orbitalStreams = [];
    let sparkParticles = [];

    // Stages:
    // 0: [MATRIX CONVERGENCE]
    // 1: [ATMOSPHERIC SURGE & SHOCKWAVE]
    // 2: [DARK TITANIUM SOLIDIFY]
    // 3: [STEALTH DEFENSE ORBIT]
    let frame = 0;
    let stage = 0;
    let flashIntensity = 0;
    let shockwaveRadius = 0;
    let stageListener = null;

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

    // Interactive mouse state
    let mouse = { x: -1000, y: -1000, active: false };

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active = true;
    });

    canvas.addEventListener('mouseleave', () => {
      mouse.active = false;
    });

    canvas.addEventListener('click', () => {
      // Trigger smooth energy wave ripple on click
      flashIntensity = 0.45;
      shockwaveRadius = 14;
      for (let i = 0; i < 20; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 1.5 + Math.random() * 3.5;
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

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, RAIN_DPR_CAP);
      w = canvas.clientWidth || canvas.parentElement?.clientWidth || 550;
      h = canvas.clientHeight || canvas.parentElement?.clientHeight || 550;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cx = w / 2;
      cy = h / 2;

      // Generous shield size fitting comfortably with room for orbital telemetry
      sw = Math.min(w * 0.68, Math.min(h * 0.72, 380));
      sh = sw * 1.25;

      columns = Math.max(16, Math.floor(w / FONT_SIZE));
      drops = Array.from({ length: columns }, () => Math.random() * -60);
      speeds = Array.from({ length: columns }, () => 0.48 + Math.random() * 0.82);

      shieldPoints = generateShieldPoints(cx, cy, sw, sh, 120);
      hackerPoints = generateHackerPoints(cx, cy, sw, sh);

      // Create running orbital streams
      orbitalStreams = [];
      const totalPoints = shieldPoints.length;

      // Stream 1: Clockwise primary stream (Green & White digits)
      for (let i = 0; i < 48; i++) {
        orbitalStreams.push({
          pos: (i / 48) * totalPoints,
          speed: 0.62 + (i % 3) * 0.08,
          char: CHARS[i % 2],
          color: i % 4 === 0 ? COLOR_WHITE : COLOR_PRIMARY,
          offset: 14 + (Math.random() - 0.5) * 5
        });
      }

      // Stream 2: Counter-Clockwise outer stream (Cyan Hex digits)
      for (let i = 0; i < 32; i++) {
        orbitalStreams.push({
          pos: (i / 32) * totalPoints,
          speed: -(0.42 + (i % 2) * 0.12),
          char: HEX_CHARS[i % HEX_CHARS.length],
          color: i % 3 === 0 ? COLOR_WHITE : COLOR_ACCENT,
          offset: 23 + (Math.random() - 0.5) * 6
        });
      }
    }

    // Dynamic Deflecting Background Matrix Rain
    function drawDeflectingRain() {
      ctx.font = `${FONT_SIZE}px monospace`;

      for (let i = 0; i < columns; i++) {
        let x = i * FONT_SIZE;
        let y = drops[i] * FONT_SIZE;

        // Forcefield Deflection: If raindrop encounters solidified shield
        if (stage >= 2 && shieldPoints.length > 0) {
          const hit = isPointInsidePolygon(x, y, shieldPoints);
          if (hit) {
            const dir = x >= cx ? 1 : -1;
            x += dir * 18;

            // Spawn realistic spark ember
            if (Math.random() < 0.07 && sparkParticles.length < 50) {
              sparkParticles.push({
                x,
                y,
                vx: dir * (1.2 + Math.random() * 2.2),
                vy: (Math.random() - 0.4) * 2.5,
                life: 0.9,
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
          ctx.fillStyle = 'rgba(0, 212, 255, 0.45)';
        } else {
          ctx.fillStyle = 'rgba(0, 255, 157, 0.55)';
        }

        ctx.fillText(ch, x, y);

        drops[i] += speeds[i];
        if (y > h + FONT_SIZE * 2) {
          drops[i] = Math.random() * -20;
        }
      }
    }

    // Phase 1: Matrix Binary Convergence
    function drawConvergencePhase(progress) {
      ctx.font = '12px monospace';

      // 1. Full Shield Outline forming from converging binary code
      const shieldCount = Math.floor(shieldPoints.length * Math.min(1, progress * 1.25));
      for (let i = 0; i < shieldCount; i++) {
        const pt = shieldPoints[i];
        const jitter = (1 - progress) * 30;
        const jx = (Math.random() - 0.5) * jitter;
        const jy = (Math.random() - 0.5) * jitter;
        const ch = HEX_CHARS[(Math.random() * HEX_CHARS.length) | 0];

        ctx.fillStyle = Math.random() < 0.2 ? COLOR_WHITE : COLOR_PRIMARY;
        ctx.shadowColor = COLOR_PRIMARY;
        ctx.shadowBlur = 7;
        ctx.fillText(ch, pt.x + jx - 4, pt.y + jy + 4);
      }
      ctx.shadowBlur = 0;

      // 2. Hooded hacker & laptop facing the hacker
      const hackerCount = Math.floor(hackerPoints.length * Math.min(1, progress * 1.35));
      for (let i = 0; i < hackerCount; i++) {
        const hp = hackerPoints[i];
        const jitter = (1 - progress) * 18;
        const jx = (Math.random() - 0.5) * jitter;
        const jy = (Math.random() - 0.5) * jitter;
        const ch = CHARS[(Math.random() * CHARS.length) | 0];

        if (hp.type === 'logo') {
          // Illuminated emblem on the back of the laptop lid
          ctx.fillStyle = COLOR_ACCENT;
          ctx.shadowColor = COLOR_ACCENT;
          ctx.shadowBlur = 14;
          ctx.fillText(ch, hp.x + jx - 4, hp.y + jy + 4);
        } else if (hp.type === 'screen-glow') {
          // Screen light radiating upward from behind the lid
          ctx.fillStyle = '#bdfce0';
          ctx.shadowColor = COLOR_PRIMARY;
          ctx.shadowBlur = 10;
          ctx.fillText(ch, hp.x + jx - 4, hp.y + jy + 4);
        } else if (hp.type === 'hands') {
          ctx.fillStyle = COLOR_PRIMARY;
          ctx.shadowColor = COLOR_PRIMARY;
          ctx.shadowBlur = 6;
          ctx.fillText(ch, hp.x + jx - 4, hp.y + jy + 4);
        } else {
          // Hood and back of laptop lid
          ctx.fillStyle = 'rgba(0, 255, 157, 0.70)';
          ctx.fillText(ch, hp.x + jx - 4, hp.y + jy + 4);
        }
      }
      ctx.shadowBlur = 0;

      // Energy perimeter mesh appearing as convergence nears 100%
      if (progress > 0.45) {
        ctx.save();
        ctx.strokeStyle = `rgba(0, 212, 255, ${(progress - 0.45) * 0.75})`;
        ctx.lineWidth = 1.5;
        getShieldPath(ctx, cx, cy, sw, sh);
        ctx.stroke();
        ctx.restore();
      }

      // Screen light cast behind the laptop lid intensifies before pulse
      if (progress > 0.75) {
        const glowRad = (progress - 0.75) * 4 * sw * 0.28;
        const grad = ctx.createRadialGradient(cx, cy + sh * 0.04, 2, cx, cy - sh * 0.08, glowRad);
        grad.addColorStop(0, 'rgba(0, 212, 255, 0.45)');
        grad.addColorStop(1, 'rgba(0, 212, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy + sh * 0.02, glowRad, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Phase 2: Atmospheric Surge & Shockwave (No chaotic lightning)
    function drawAtmosphericPulse() {
      if (flashIntensity <= 0.01) return;
      ctx.save();

      // Atmospheric screen bloom (vignette glow instead of harsh whiteout)
      const flashGrad = ctx.createRadialGradient(cx, cy, sw * 0.2, cx, cy, sw * 1.2);
      flashGrad.addColorStop(0, `rgba(0, 212, 255, ${flashIntensity * 0.65})`);
      flashGrad.addColorStop(0.5, `rgba(0, 255, 157, ${flashIntensity * 0.35})`);
      flashGrad.addColorStop(1, 'rgba(4, 6, 12, 0)');
      ctx.fillStyle = flashGrad;
      ctx.fillRect(0, 0, w, h);

      // Expanding sleek cyan shockwave ring
      shockwaveRadius += 16;
      ctx.strokeStyle = `rgba(0, 212, 255, ${flashIntensity * 0.9})`;
      ctx.lineWidth = 6 * flashIntensity;
      ctx.beginPath();
      ctx.arc(cx, cy, shockwaveRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Secondary tight emerald ring
      ctx.strokeStyle = `rgba(0, 255, 157, ${flashIntensity * 0.6})`;
      ctx.lineWidth = 3 * flashIntensity;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, shockwaveRadius - 22), 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }

    // Phase 3 & 4: Dark Realism Solidified Shield with Hooded Hacker & Laptop Facing Hacker
    function drawSolidifiedShield(pulse) {
      ctx.save();

      // 1. Outer Neon Edge Glow
      ctx.shadowColor = COLOR_PRIMARY;
      ctx.shadowBlur = 24 + pulse * 12;
      ctx.strokeStyle = `rgba(0, 255, 157, ${0.85 + pulse * 0.15})`;
      ctx.lineWidth = 2.6;
      getShieldPath(ctx, cx, cy, sw + 4, sh + 4);
      ctx.stroke();

      // 2. Realistic Chamfered Steel Bevel
      ctx.shadowColor = COLOR_ACCENT;
      ctx.shadowBlur = 12 + pulse * 6;
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.85)';
      ctx.lineWidth = 1.8;
      getShieldPath(ctx, cx, cy, sw, sh);
      ctx.stroke();

      // 3. Dark Titanium-Carbon Shield Surface
      const metalGrad = ctx.createLinearGradient(cx - sw / 2, cy - sh / 2, cx + sw / 2, cy + sh / 2);
      metalGrad.addColorStop(0, '#152238');
      metalGrad.addColorStop(0.25, '#0c1524');
      metalGrad.addColorStop(0.7, '#101a2e');
      metalGrad.addColorStop(1, '#080e1a');

      ctx.fillStyle = metalGrad;
      getShieldPath(ctx, cx, cy, sw, sh);
      ctx.fill();

      // 4. Subtle Carbon-Fiber Hexagonal Lattice
      ctx.save();
      getShieldPath(ctx, cx, cy, sw - 8, sh - 8);
      ctx.clip();

      ctx.strokeStyle = `rgba(0, 255, 157, ${0.14 + pulse * 0.08})`;
      ctx.lineWidth = 1;
      const hexR = 20;
      for (let y = cy - sh * 0.46; y < cy + sh * 0.48; y += hexR * 1.5) {
        for (let x = cx - sw * 0.48; x < cx + sw * 0.48; x += hexR * Math.sqrt(3)) {
          drawHexagon(ctx, x, y, hexR);
        }
      }
      ctx.stroke();
      ctx.restore();

      // 5. Dark Hardware Rivets / Hex Studs
      drawHardwareStuds();

      // 6. Embossed Realistic Hacker & Laptop Facing the Hacker
      drawHackerWithLaptopFacingHim(pulse);

      // 7. Recessed Neon Circuit Waveguides
      ctx.strokeStyle = `rgba(0, 212, 255, ${0.28 + pulse * 0.32})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      // Upper vertical circuit
      ctx.moveTo(cx, cy - sh * 0.44);
      ctx.lineTo(cx, cy - sh * 0.28);
      // Lower vertical circuit
      ctx.moveTo(cx, cy + sh * 0.28);
      ctx.lineTo(cx, cy + sh * 0.47);
      // Lateral wing traces
      ctx.moveTo(cx - sw * 0.42, cy - sh * 0.04);
      ctx.lineTo(cx - sw * 0.24, cy - sh * 0.04);
      ctx.moveTo(cx + sw * 0.24, cy - sh * 0.04);
      ctx.lineTo(cx + sw * 0.42, cy - sh * 0.04);
      ctx.stroke();

      ctx.restore();
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

    function drawHardwareStuds() {
      ctx.save();
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
        ctx.fillStyle = '#060a12';
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Realistic Hacker with Laptop FACING HIM:
    // We see the back of the laptop lid with an illuminated cyber emblem,
    // while the glowing screen faces away from us, lighting the hacker's chest and hood.
    function drawHackerWithLaptopFacingHim(pulse) {
      ctx.save();

      const hoodTopY = cy - sh * 0.26;
      const hoodW = sw * 0.36;
      const hoodH = sh * 0.38;

      const lidTopY = cy + sh * 0.04;
      const lidHingeY = cy + sh * 0.18;
      const lidTopW = sw * 0.30;
      const lidBotW = sw * 0.34;

      // 1. Upward Conical Light Beaming from Behind Laptop Lid into Hacker's Face & Hood
      const spillGrad = ctx.createRadialGradient(cx, lidTopY + 4, 8, cx, cy - sh * 0.12, sw * 0.32);
      spillGrad.addColorStop(0, `rgba(0, 212, 255, ${0.75 + pulse * 0.2})`);
      spillGrad.addColorStop(0.35, `rgba(0, 255, 157, ${0.42 + pulse * 0.15})`);
      spillGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = spillGrad;
      ctx.beginPath();
      ctx.moveTo(cx - lidTopW / 2 - 12, lidTopY + 12);
      ctx.lineTo(cx - hoodW * 0.55, hoodTopY + hoodH * 0.45);
      ctx.lineTo(cx + hoodW * 0.55, hoodTopY + hoodH * 0.45);
      ctx.lineTo(cx + lidTopW / 2 + 12, lidTopY + 12);
      ctx.closePath();
      ctx.fill();

      // 2. Dark Hoodie Silhouette & Hunched Posture
      ctx.fillStyle = '#0a101d';
      ctx.beginPath();
      // Hood top peak
      ctx.moveTo(cx, hoodTopY - 10);
      // Left hood arc down to shoulder and forearm
      ctx.bezierCurveTo(cx - hoodW * 0.55, hoodTopY, cx - hoodW * 0.65, hoodTopY + hoodH * 0.5, cx - hoodW * 0.5, hoodTopY + hoodH * 0.85);
      ctx.lineTo(cx - sw * 0.34, cy + sh * 0.28);
      ctx.lineTo(cx + sw * 0.34, cy + sh * 0.28);
      ctx.lineTo(cx + hoodW * 0.5, hoodTopY + hoodH * 0.85);
      ctx.bezierCurveTo(cx + hoodW * 0.65, hoodTopY + hoodH * 0.5, cx + hoodW * 0.55, hoodTopY, cx, hoodTopY - 10);
      ctx.closePath();
      ctx.fill();

      // Subtle fabric fold highlights along the hood edge
      ctx.strokeStyle = `rgba(0, 255, 157, ${0.5 + pulse * 0.25})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 3. Deep Shadow / Pitch-Black Face Void (NO face, pure anonymity)
      ctx.fillStyle = '#03050c';
      ctx.beginPath();
      ctx.ellipse(cx, cy - sh * 0.11, hoodW * 0.32, hoodH * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();

      // Under-hood specular rim light catching the edge of the fabric from the screen
      ctx.strokeStyle = `rgba(0, 212, 255, ${0.7 + pulse * 0.25})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy - sh * 0.06, hoodW * 0.25, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();

      // 4. Hacker's Hands Reaching Around the Laptop Lid (typing on the keyboard behind the screen)
      ctx.fillStyle = '#050a14';
      ctx.strokeStyle = `rgba(0, 212, 255, ${0.5 + pulse * 0.2})`;
      ctx.lineWidth = 1.2;

      // Left hand/wrist reaching around left edge of lid
      ctx.beginPath();
      ctx.ellipse(cx - lidBotW * 0.52, lidHingeY - 8, 8, 5, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Right hand/wrist reaching around right edge of lid
      ctx.beginPath();
      ctx.ellipse(cx + lidBotW * 0.52, lidHingeY - 8, 8, 5, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 5. Intense Screen Glow Spill Line Across the Top Edge of the Lid
      ctx.save();
      ctx.shadowColor = COLOR_ACCENT;
      ctx.shadowBlur = 18 + pulse * 8;
      ctx.strokeStyle = COLOR_ACCENT;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(cx - lidTopW * 0.48, lidTopY - 1);
      ctx.lineTo(cx + lidTopW * 0.48, lidTopY - 1);
      ctx.stroke();
      ctx.restore();

      // 6. The Laptop Lid (Back of display facing viewer, tilted slightly forward in perspective)
      const lidGrad = ctx.createLinearGradient(cx - lidTopW / 2, lidTopY, cx + lidBotW / 2, lidHingeY);
      lidGrad.addColorStop(0, '#1c283d');
      lidGrad.addColorStop(0.35, '#0e1726');
      lidGrad.addColorStop(0.7, '#131e33');
      lidGrad.addColorStop(1, '#09101d');

      ctx.fillStyle = lidGrad;
      ctx.beginPath();
      ctx.moveTo(cx - lidTopW / 2, lidTopY);
      ctx.lineTo(cx + lidTopW / 2, lidTopY);
      ctx.lineTo(cx + lidBotW / 2, lidHingeY);
      ctx.lineTo(cx - lidBotW / 2, lidHingeY);
      ctx.closePath();
      ctx.fill();

      // Beveled metallic lid rim
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Laptop Hinge Bar at bottom of lid
      ctx.fillStyle = '#060a12';
      ctx.strokeStyle = 'rgba(0, 255, 157, 0.35)';
      ctx.lineWidth = 1;
      ctx.fillRect(cx - lidBotW * 0.54, lidHingeY, lidBotW * 1.08, 4.5);
      ctx.strokeRect(cx - lidBotW * 0.54, lidHingeY, lidBotW * 1.08, 4.5);

      // 7. Glowing NexVault Cyber Shield Emblem on Back of Laptop Lid
      const logoY = (lidTopY + lidHingeY) / 2;
      const logoW = 18;
      const logoH = 22;

      ctx.save();
      ctx.shadowColor = COLOR_ACCENT;
      ctx.shadowBlur = 14 + pulse * 8;
      ctx.strokeStyle = COLOR_ACCENT;
      ctx.lineWidth = 1.6;
      ctx.fillStyle = 'rgba(0, 212, 255, 0.18)';

      // Mini shield outline on back of laptop lid
      ctx.beginPath();
      ctx.moveTo(cx, logoY - logoH * 0.45);
      ctx.bezierCurveTo(cx + logoW * 0.5, logoY - logoH * 0.45, cx + logoW * 0.5, logoY, cx, logoY + logoH * 0.5);
      ctx.bezierCurveTo(cx - logoW * 0.5, logoY, cx - logoW * 0.5, logoY - logoH * 0.45, cx, logoY - logoH * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Center glowing lock / core node on the emblem
      ctx.fillStyle = COLOR_WHITE;
      ctx.fillRect(cx - 2, logoY - 2, 4, 4);
      ctx.restore();

      ctx.restore();
    }

    // Phase 4: Fast Running Binary & Hex Streams continuously Orbiting the Shield
    function drawRunningOrbitingBinary() {
      ctx.font = '12px monospace';
      ctx.save();

      const totalPoints = shieldPoints.length;

      for (const stream of orbitalStreams) {
        // Continuous perpetual orbit around the shield perimeter
        stream.pos = (stream.pos + stream.speed + totalPoints) % totalPoints;
        const idx = Math.floor(stream.pos);
        const nextIdx = (idx + 1) % totalPoints;
        const frac = stream.pos - idx;

        const p1 = shieldPoints[idx];
        const p2 = shieldPoints[nextIdx];
        if (!p1 || !p2) continue;

        const baseX = p1.x + (p2.x - p1.x) * frac;
        const baseY = p1.y + (p2.y - p1.y) * frac;

        // Normal perpendicular vector to maintain clean distance from shield edge
        const nx = p1.nx || 0;
        const ny = p1.ny || 0;
        const x = baseX + nx * stream.offset;
        const y = baseY + ny * stream.offset;

        ctx.fillStyle = stream.color;
        ctx.shadowColor = stream.color;
        ctx.shadowBlur = 9;
        ctx.fillText(stream.char, x - 4, y + 4);
      }
      ctx.shadowBlur = 0;

      // Render Active Deflection Sparks
      for (let i = sparkParticles.length - 1; i >= 0; i--) {
        const sp = sparkParticles[i];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.life -= 0.035;

        if (sp.life <= 0) {
          sparkParticles.splice(i, 1);
          continue;
        }

        ctx.fillStyle = sp.color;
        ctx.globalAlpha = sp.life;
        ctx.fillRect(sp.x, sp.y, 2, 2);
      }
      ctx.globalAlpha = 1.0;

      ctx.restore();
    }

    function replay() {
      frame = 0;
      setStage(0);
      flashIntensity = 0;
      shockwaveRadius = 0;
      columns = Math.max(16, Math.floor(w / FONT_SIZE));
      drops = Array.from({ length: columns }, () => Math.random() * -60);
    }

    canvas.__nv_replay = replay;

    function tick() {
      frame++;

      // Sequence Timings
      if (stage === 0) {
        // [0: CONVERGING]: 0 - 145 frames (~2.4s)
        if (frame > 145) {
          setStage(1);
          flashIntensity = 1.0;
          shockwaveRadius = 12;
        }
      } else if (stage === 1) {
        // [1: ATMOSPHERIC PULSE]: ~25 frames
        flashIntensity -= 0.038;
        if (flashIntensity <= 0.04) {
          flashIntensity = 0;
          setStage(2); // SOLIDIFYING
        }
      } else if (stage === 2) {
        // [2: SOLIDIFYING]: ~30 frames
        if (frame > 210) {
          setStage(3); // ACTIVE DEFENSE ORBIT
        }
      } else if (stage === 3) {
        // Keep active defense looping after extended viewing (~20 seconds)
        if (frame > 1200) {
          replay();
        }
      }

      // Smooth dark canvas clearing with trailing glow
      ctx.fillStyle = 'rgba(4, 6, 12, 0.22)';
      ctx.fillRect(0, 0, w, h);

      // Background matrix rain with active deflection physics
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

    window.addEventListener('resize', resize);
    resize();
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
