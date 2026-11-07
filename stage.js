/* Stage effects: opening sequence, follow spot, drifting dust, film scratches and slow grainy rings.
   Purely visual. The form logic lives in app.js. */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var html = document.documentElement;

  // ------------------------------------------------------------ Opening
  var opening = document.getElementById('opening');
  var openingDone = false;
  var skipEvents = ['keydown', 'pointerdown', 'wheel', 'touchstart'];

  function endOpening() {
    if (openingDone) return;
    openingDone = true;
    skipEvents.forEach(function (ev) { window.removeEventListener(ev, endOpening, true); });
    html.classList.remove('is-opening');
    if (!opening) return;
    opening.classList.add('is-done');
    setTimeout(function () { if (opening && opening.parentNode) opening.parentNode.removeChild(opening); }, 1050);
  }

  // The opening plays on every page load; any key, click or tap skips it.
  if (!opening || reduce) {
    if (opening && opening.parentNode) opening.parentNode.removeChild(opening);
    openingDone = true;
  } else {
    html.classList.add('is-opening');
    setTimeout(endOpening, 3700);
    skipEvents.forEach(function (ev) {
      window.addEventListener(ev, endOpening, { capture: true, passive: true });
    });
  }

  // ------------------------------------------------------------ Canvas
  var canvas = document.getElementById('stageCanvas');
  var spotEl = document.getElementById('spot');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 0, H = 0, DPR = 1;
  var builtW = 0, builtH = 0;
  var dust = [];
  var rings = [];
  var scratches = [];
  var nextScratch = 0;

  // Follow spot: rests on the hook line until the visitor moves the pointer.
  var spot = { x: 0, y: 0, tx: 0, ty: 0 };
  var lastPointer = -1e9;
  var anchor = document.getElementById('hook');

  function rand(a, b) { return a + Math.random() * (b - a); }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // Mobile address bars change the height while scrolling; only rebuild for real size changes.
    if (Math.abs(W - builtW) > 40 || Math.abs(H - builtH) > 160) {
      builtW = W; builtH = H;
      buildDust();
      buildRings();
    }
    if (!spot.x) { spot.x = spot.tx = W * 0.5; spot.y = spot.ty = H * 0.42; }
    if (reduce) draw(0);
  }

  function buildDust() {
    var n = Math.round(Math.max(36, Math.min(120, (W * H) / 14000)));
    dust = [];
    for (var i = 0; i < n; i++) {
      dust.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: rand(0.35, 1.7),
        vx: rand(-0.008, 0.008),
        vy: -rand(0.004, 0.02),
        a: rand(0.1, 0.5),
        ph: Math.random() * Math.PI * 2,
        sp: rand(0.4, 1.3)
      });
    }
  }

  // Grainy concentric bands drawn once, then rotated each frame.
  function ringSprite(radius, innerRatio, bands) {
    var size = Math.ceil(radius * 2);
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var inner = radius * innerRatio;
    var span = radius - inner;
    var bandW = span / bands;
    var n = Math.min(140000, Math.round(Math.PI * (radius * radius - inner * inner) * 0.14));
    for (var i = 0; i < n; i++) {
      var r = Math.sqrt(inner * inner + Math.random() * (radius * radius - inner * inner));
      var b = (r - inner) / bandW;
      var lit = Math.floor(b) % 2 === 0;
      var keep = lit ? 0.25 + 0.75 * Math.sin((b % 1) * Math.PI) : 0.05;
      if (Math.random() > keep) continue;
      var ang = Math.random() * Math.PI * 2;
      var fade = 1 - ((r - inner) / span) * 0.6;
      var red = Math.random() < 0.4;
      g.fillStyle = red
        ? 'rgba(238,36,54,' + (0.34 * fade).toFixed(3) + ')'
        : 'rgba(226,214,204,' + (0.42 * fade * (0.3 + 0.7 * Math.random())).toFixed(3) + ')';
      g.fillRect(radius + Math.cos(ang) * r, radius + Math.sin(ang) * r, 1.4, 1.4);
    }
    return c;
  }

  function buildRings() {
    var m = Math.min(W, H);
    var big = Math.max(180, m * 0.56);
    var small = Math.max(110, m * 0.27);
    rings = [
      { img: ringSprite(big, 0.2, 7), cx: W * 0.97, cy: H * 1.02, r: big, speed: 0.000018, alpha: 0.9, ph: 0 },
      { img: ringSprite(small, 0.24, 5), cx: W * 0.01, cy: H * -0.02, r: small, speed: -0.000026, alpha: 0.75, ph: 2 }
    ];
  }

  function spawnScratch(t) {
    var len = rand(18, 90);
    var ang = rand(0, Math.PI * 2);
    var x = rand(0, W), y = rand(0, H);
    scratches.push({
      x: x, y: y,
      x2: x + Math.cos(ang) * len, y2: y + Math.sin(ang) * len,
      cx: x + Math.cos(ang + rand(-0.9, 0.9)) * len * 0.6,
      cy: y + Math.sin(ang + rand(-0.9, 0.9)) * len * 0.6,
      born: t,
      life: rand(240, 520)
    });
    nextScratch = t + rand(700, 2400);
  }

  // ------------------------------------------------------------ Update and draw
  function update(t) {
    var pointerActive = t - lastPointer < 6000;
    if (pointerActive) {
      // target already set by pointer
    } else if (anchor && anchor.offsetParent !== null) {
      var rect = anchor.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < H) {
        spot.tx = rect.left + rect.width * 0.5 + Math.sin(t * 0.00035) * rect.width * 0.18;
        spot.ty = rect.top + rect.height * 0.5 + Math.cos(t * 0.00029) * 18;
      } else {
        drift(t);
      }
    } else {
      drift(t);
    }
    spot.x += (spot.tx - spot.x) * 0.045;
    spot.y += (spot.ty - spot.y) * 0.045;
    if (spotEl) {
      spotEl.style.setProperty('--sx', spot.x.toFixed(1) + 'px');
      spotEl.style.setProperty('--sy', spot.y.toFixed(1) + 'px');
    }

    if (!reduce && t > nextScratch) spawnScratch(t);
    scratches = scratches.filter(function (s) { return t - s.born < s.life; });
  }

  function drift(t) {
    spot.tx = W * (0.5 + 0.2 * Math.sin(t * 0.00012));
    spot.ty = H * (0.36 + 0.1 * Math.cos(t * 0.00009));
  }

  function draw(t, dt) {
    ctx.clearRect(0, 0, W, H);

    // Rings
    rings.forEach(function (ring) {
      ctx.save();
      ctx.globalAlpha = ring.alpha;
      ctx.translate(ring.cx, ring.cy);
      ctx.rotate(t * ring.speed + ring.ph);
      var s = 1 + 0.012 * Math.sin(t * 0.0004 + ring.ph);
      ctx.scale(s, s);
      ctx.drawImage(ring.img, -ring.r, -ring.r);
      ctx.restore();
    });

    // Dust, brighter when it drifts through the light
    var reach = Math.min(W, H) * 0.42;
    for (var i = 0; i < dust.length; i++) {
      var p = dust[i];
      if (dt) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        if (p.x < -4) p.x = W + 4;
        if (p.x > W + 4) p.x = -4;
      }
      var dx = p.x - spot.x, dy = p.y - spot.y;
      var lit = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / reach);
      var tw = 0.6 + 0.4 * Math.sin(t * 0.001 * p.sp + p.ph);
      var a = p.a * tw * (0.45 + 1.4 * lit);
      ctx.fillStyle = 'rgba(255,238,222,' + Math.min(0.9, a).toFixed(3) + ')';
      if (p.r > 1) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x, p.y, p.r * 1.6, p.r * 1.6);
      }
    }

    // Film scratches flicker in and out
    ctx.lineWidth = 0.7;
    ctx.lineCap = 'round';
    scratches.forEach(function (s) {
      var k = (t - s.born) / s.life;
      ctx.strokeStyle = 'rgba(230,222,214,' + (0.32 * Math.sin(Math.PI * k)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(s.cx, s.cy, s.x2, s.y2);
      ctx.stroke();
    });
  }

  var last = 0;
  function frame(t) {
    var dt = last ? Math.min(64, t - last) : 16;
    last = t;
    update(t);
    draw(t, dt);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ Events
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    lastPointer = performance.now();
    spot.tx = e.clientX;
    spot.ty = e.clientY;
  }, { passive: true });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  // After the introduction, the spot drifts over the stage instead of resting on the hook line.
  document.addEventListener('stage:begin', function () { anchor = null; });

  resize();
  if (reduce) {
    update(0);
    draw(0, 0);
  } else {
    requestAnimationFrame(frame);
  }
})();
