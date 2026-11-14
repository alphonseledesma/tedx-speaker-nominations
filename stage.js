/* Visuals for the poster direction: the living gradient field, the striped sphere, and the opening.
   Purely visual. The form logic lives in app.js. */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var html = document.documentElement;

  var C = {
    ink: [11, 6, 6],
    ember: [238, 36, 54],
    flare: [255, 91, 31],
    wine: [79, 9, 16],
    cream: [255, 236, 214],
  };
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeInOut(u) { u = clamp01(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function easeIn(u) { u = clamp01(u); return u * u * u; }

  // ------------------------------------------------------------ The striped sphere
  // Horizontal bands clipped to a circle. Hot cream and orange in the middle, red to the sides,
  // bands thickest at the equator. The stripes drift slowly downward, like a scanning light.
  // hole (0 to 1) cuts a soft black centre out of the sphere, as a share of its radius.
  function drawSphere(ctx, cx, cy, R, t, open, hole) {
    if (R <= 0) return;
    open = open == null ? 1 : open;
    hole = hole || 0;
    var bands = 15;
    var step = (2 * R) / bands;
    var offset = ((t * 0.012) % step + step) % step;

    // soft halo behind the sphere
    var halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.6);
    halo.addColorStop(0, rgba(C.flare, 0.28 * open));
    halo.addColorStop(1, rgba(C.flare, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    for (var i = -1; i <= bands; i++) {
      var yc = cy - R + step * (i + 0.5) + offset;
      var dy = (yc - cy) / R;                                   // -1 top … 1 bottom
      if (Math.abs(dy) >= 1) continue;
      var half = Math.sqrt(1 - dy * dy) * R;
      var pulse = 0.5 + 0.5 * Math.sin(t * 0.0013 + i * 0.6);
      var share = (0.28 + 0.52 * (1 - Math.abs(dy)) + 0.12 * pulse) * open;
      var h = step * Math.min(0.94, share);
      var hot = clamp01(1 - Math.abs(dy + 0.18) * 1.15);          // hottest just above the middle
      var core = mix(C.ember, C.cream, Math.pow(hot, 1.5));
      var mid = mix(C.ember, C.flare, hot);
      var g = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
      g.addColorStop(0, rgba(C.wine, 0));
      g.addColorStop(0.16, rgba(C.ember, 0.75));
      g.addColorStop(0.34, rgba(mid, 0.95));
      g.addColorStop(0.5, rgba(core, 1));
      g.addColorStop(0.66, rgba(mid, 0.95));
      g.addColorStop(0.84, rgba(C.ember, 0.75));
      g.addColorStop(1, rgba(C.wine, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - half, yc - h / 2, half * 2, h);
    }
    if (hole > 0.01) {
      var core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      core.addColorStop(0, rgba(C.ink, 1));
      core.addColorStop(Math.max(0, hole - 0.05), rgba(C.ink, 1));
      core.addColorStop(Math.min(1, hole + 0.05), rgba(C.ink, 0));
      core.addColorStop(1, rgba(C.ink, 0));
      ctx.fillStyle = core;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ The gradient field
  // Drawn small and stretched to full screen, so the browser's scaling blurs it into soft light.
  var field = document.getElementById('field');
  var fctx = field ? field.getContext('2d') : null;
  var FW = 0, FH = 0;
  // Mostly black: a red glow behind the sphere, a low wine glow, and a few thin red streaks.
  var blobs = [
    { c: C.ember, x: 0.8, y: 0.26, r: 0.42, sx: 1.3, a: 0.42, ax: 0.05, ay: 0.04, sp: 0.00011, ph: 0.0 },
    { c: C.flare, x: 0.76, y: 0.24, r: 0.14, sx: 2.2, a: 0.22, ax: 0.06, ay: 0.03, sp: 0.00016, ph: 1.7 },
    { c: C.wine, x: 0.12, y: 0.86, r: 0.55, sx: 1.6, a: 0.55, ax: 0.06, ay: 0.05, sp: 0.00009, ph: 3.1 },
    // motion streaks
    { c: C.ember, x: 0.42, y: 0.46, r: 0.035, sx: 18, a: 0.34, ax: 0.25, ay: 0.02, sp: 0.00018, ph: 0.9 },
    { c: C.ember, x: 0.6, y: 0.64, r: 0.025, sx: 22, a: 0.26, ax: 0.3, ay: 0.02, sp: 0.00014, ph: 2.6 },
    { c: C.flare, x: 0.7, y: 0.36, r: 0.018, sx: 24, a: 0.16, ax: 0.2, ay: 0.015, sp: 0.00024, ph: 5.0 },
  ];
  var scrollShift = 0;

  function sizeField() {
    if (!field) return;
    FW = Math.max(64, Math.round(window.innerWidth * 0.12));
    FH = Math.max(64, Math.round(window.innerHeight * 0.12));
    field.width = FW;
    field.height = FH;
  }

  function drawField(t) {
    if (!fctx) return;
    fctx.globalCompositeOperation = 'source-over';
    fctx.fillStyle = rgba(C.ink, 1);
    fctx.fillRect(0, 0, FW, FH);
    fctx.globalCompositeOperation = 'screen';
    var m = Math.max(FW, FH);
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var x = (b.x + b.ax * Math.sin(t * b.sp + b.ph)) * FW;
      var y = (b.y + b.ay * Math.cos(t * b.sp * 1.3 + b.ph) - scrollShift * 0.35) * FH;
      var r = b.r * m;
      fctx.save();
      fctx.translate(x, y);
      fctx.scale(b.sx, 1);
      var g = fctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, rgba(b.c, b.a));
      g.addColorStop(0.55, rgba(b.c, b.a * 0.35));
      g.addColorStop(1, rgba(b.c, 0));
      fctx.fillStyle = g;
      fctx.fillRect(-r, -r, r * 2, r * 2);
      fctx.restore();
    }
    // darken the edges so text always has somewhere to sit
    fctx.globalCompositeOperation = 'source-over';
    var v = fctx.createRadialGradient(FW * 0.6, FH * 0.35, Math.min(FW, FH) * 0.2, FW * 0.5, FH * 0.5, m * 0.85);
    v.addColorStop(0, rgba(C.ink, 0));
    v.addColorStop(1, rgba(C.ink, 0.85));
    fctx.fillStyle = v;
    fctx.fillRect(0, 0, FW, FH);
  }

  // ------------------------------------------------------------ The sphere in the hero
  var orb = document.getElementById('heroOrb');
  var octx = orb ? orb.getContext('2d') : null;
  var orbVisible = true;
  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  function sizeOrb() {
    if (!orb) return;
    var rect = orb.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    orb.width = Math.max(1, Math.round(rect.width * dpr));
    orb.height = Math.max(1, Math.round(rect.height * dpr));
  }

  function drawOrb(t) {
    if (!octx || !orbVisible) return;
    var w = orb.width, h = orb.height;
    octx.clearRect(0, 0, w, h);
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    var R = Math.min(w, h) * 0.36 * (1 + 0.015 * Math.sin(t * 0.0009));
    drawSphere(octx, w / 2 + pointer.x * w * 0.03, h / 2 + pointer.y * h * 0.03, R, t, 1);
  }

  if (orb && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      orbVisible = entries[0].isIntersecting && !orb.closest('[hidden]');
    }).observe(orb);
  }

  // ------------------------------------------------------------ The opening
  // A thin line of light opens into the striped circle, its centre goes black, and the circle
  // grows just enough for the one-line logo to sit inside that black centre. The circle and
  // the logo share the exact centre of the screen. Then the page fades in.
  var opening = document.getElementById('opening');
  var ocanvas = document.getElementById('openingCanvas');
  var ctxO = ocanvas ? ocanvas.getContext('2d') : null;
  var openingDone = true;
  var skipEvents = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
  var T = { line: 250, opened: 1400, holeFrom: 900, holeTo: 1900, grow: 1400, grown: 2500, logo: 2300, end: 4200 };   // ms
  var HOLE = 0.64;   // the black centre, as a share of the circle's radius

  // Must match .opening-logo's width in styles.css.
  function logoWidth() { return Math.min(window.innerWidth * 0.56, 440); }

  function endOpening() {
    if (openingDone) return;
    openingDone = true;
    skipEvents.forEach(function (ev) { window.removeEventListener(ev, endOpening, true); });
    html.classList.remove('is-opening');
    if (!opening) return;
    opening.classList.add('is-done');
    setTimeout(function () { if (opening.parentNode) opening.parentNode.removeChild(opening); }, 1050);
  }

  var odpr = 1;
  function sizeOpening() {
    if (!ocanvas) return;
    odpr = Math.min(window.devicePixelRatio || 1, 2);
    ocanvas.width = Math.round(window.innerWidth * odpr);
    ocanvas.height = Math.round(window.innerHeight * odpr);
  }

  function drawOpening(t) {
    var w = ocanvas.width, h = ocanvas.height;
    var cx = w / 2, cy = h / 2;
    ctxO.fillStyle = rgba(C.ink, 1);
    ctxO.fillRect(0, 0, w, h);
    if (t < T.line) return;

    // start small, then grow until the black centre is wide enough for the logo
    var R0 = Math.min(w, h) * 0.24;
    var R1 = Math.max(R0 * 1.25, (logoWidth() / 2 + 30) * odpr / HOLE);
    var R = (R0 + (R1 - R0) * easeInOut((t - T.grow) / (T.grown - T.grow))) * (1 + 0.012 * Math.sin(t * 0.0011));
    var openY = Math.max(0.012, easeInOut((t - T.line) / (T.opened - T.line)));
    var hole = HOLE * easeInOut((t - T.holeFrom) / (T.holeTo - T.holeFrom));

    ctxO.save();
    ctxO.translate(cx, cy);
    ctxO.scale(1, openY);
    ctxO.translate(-cx, -cy);
    drawSphere(ctxO, cx, cy, R, t, Math.min(1, openY * 1.2), hole);
    ctxO.restore();

    opening.style.setProperty('--logo', easeInOut((t - T.logo) / 700).toFixed(3));
  }

  function runOpening() {
    openingDone = false;
    html.classList.add('is-opening');
    sizeOpening();
    var t0 = performance.now();
    (function frame(now) {
      if (openingDone) return;
      var t = now - t0;
      drawOpening(t);
      if (t >= T.end) return endOpening();
      requestAnimationFrame(frame);
    })(t0);
    skipEvents.forEach(function (ev) {
      window.addEventListener(ev, endOpening, { capture: true, passive: true });
    });
  }

  if (opening && !reduce && ctxO) {
    runOpening();
  } else {
    if (opening && opening.parentNode) opening.parentNode.removeChild(opening);
    html.classList.remove('is-opening');
  }

  // ------------------------------------------------------------ Loop and events
  function onScroll() {
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    scrollShift = window.scrollY / max;
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    pointer.tx = e.clientX / window.innerWidth - 0.5;
    pointer.ty = e.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      sizeField();
      sizeOrb();
      if (!openingDone) sizeOpening();
      if (reduce) { drawField(0); drawOrb(0); }
    }, 120);
  });

  // The hero sphere reappears when someone returns to the introduction; keep it sized.
  document.addEventListener('stage:begin', function () { orbVisible = false; });

  sizeField();
  sizeOrb();
  if (reduce) {
    drawField(0);
    drawOrb(0);
  } else {
    (function loop(now) {
      drawField(now);
      drawOrb(now);
      requestAnimationFrame(loop);
    })(performance.now());
  }
})();
