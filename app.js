(function () {
  'use strict';

  var CFG = window.PORTAL_CONFIG || {};
  // Must match CONFIG.MAX_CHARS in Code.gs
  var CAPS = { 'text': 200, 'number': 3, 'dropdown': 100, 'email': 200, 'long text': 6000 };
  var SELF_DESCRIBE = 'Prefer to self-describe';
  var DRAFT_PREFIX = 'tedx-nomination-draft:';

  var state = {
    config: null,
    token: '',
    tokenExp: 0,
    user: null,
    pendingSubmit: false,
    busy: false,
    step: 0,         // which question is on screen
    started: false,  // true once the visitor clicks "Begin nomination"
    queue: [],       // screens waiting for the introduction to end
  };
  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var controls = {};
  var keys = [];

  // ---------- Small helpers ----------
  function $(id) { return document.getElementById(id); }
  function show(id, on) { $(id).hidden = !on; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function countWords(s) {
    s = String(s || '').trim();
    return s ? s.split(/\s+/).length : 0;
  }
  function decodeJwt(token) {
    try {
      var part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var bin = atob(part + '==='.slice((part.length + 3) % 4));
      var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return null;
    }
  }

  // ---------- API ----------
  function parseJson(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  function apiGet(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(CFG.API_URL + '?' + qs).then(parseJson);
  }
  function apiPost(body) {
    // No custom headers: a plain text body avoids a CORS preflight, which Apps Script does not answer.
    return fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body) }).then(parseJson);
  }

  // ---------- Screens ----------
  function setLoading(text) {
    $('loadingText').textContent = text || 'Loading...';
    show('loading', !!text);
  }
  function fatal(message) {
    onStage(function () {
      setLoading('');
      $('fatalText').textContent = message;
      show('fatal', true);
    });
  }

  // The introduction is written in index.html. The Sheet only sets the tab title and deadline.
  function renderHero(cfg) {
    if (cfg.title) document.title = cfg.title;
    if (cfg.deadlineText && cfg.open) {
      $('deadline').textContent = 'Nominations close ' + cfg.deadlineText;
      show('deadline', true);
      Array.prototype.forEach.call(document.querySelectorAll('[data-deadline]'), function (n) {
        n.textContent = 'Closes ' + cfg.deadlineText;
        n.hidden = false;
      });
    }
  }

  // ---------- Introduction → form ----------
  // Screens requested before the visitor clicks "Begin nomination" wait here.
  function onStage(fn) {
    if (state.started) fn();
    else state.queue.push(fn);
  }

  function beginButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('#beginBtn, [data-begin]'));
  }

  function begin() {
    if (state.started || $('beginBtn').disabled) return;
    beginButtons().forEach(function (b) { b.disabled = true; });
    var intro = $('introScene');
    intro.classList.add('is-leaving');
    setTimeout(function () {
      intro.hidden = true;
      intro.classList.remove('is-leaving');
      window.scrollTo(0, 0);
      state.started = true;
      document.dispatchEvent(new CustomEvent('stage:begin'));
      var waiting = state.queue;
      state.queue = [];
      if (!waiting.length) setLoading('Setting the stage...');
      waiting.forEach(function (fn) { fn(); });
    }, REDUCED_MOTION ? 0 : 700);
  }

  function renderAccount() {
    var u = state.user;
    $('who').textContent = u.name ? u.name + ' (' + u.email + ')' : u.email;
    show('account', true);
  }

  function renderMine(list) {
    list = list || [];
    var ul = $('mineList');
    ul.textContent = '';
    list.forEach(function (n) {
      var li = el('li');
      li.appendChild(el('span', 'mine-name', n.name || 'Unnamed nominee'));
      li.appendChild(el('span', 'mine-meta', n.id + (n.submittedAt ? ', sent ' + n.submittedAt : '')));
      ul.appendChild(li);
    });
    show('mine', list.length > 0);
  }

  function showLimit(title, text) {
    $('limitTitle').textContent = title || 'You can no longer submit';
    $('limitText').textContent = text || '';
    show('nomForm', false);
    show('limitNotice', true);
  }

  // ---------- Form building ----------
  function buildForm(questions) {
    var box = $('fields');
    box.textContent = '';
    controls = {};
    keys = [];
    questions.forEach(function (q, i) { buildQuestion(box, q, i, questions.length); });
  }

  function buildQuestion(box, q, i, total) {
    var id = 'f-' + q.key;
    var wrap = el('div', 'q');
    wrap.tabIndex = -1;
    var num = el('div', 'q-num', String(i + 1));
    num.setAttribute('aria-label', 'Question ' + (i + 1) + ' of ' + total);
    wrap.appendChild(num);

    var label = el('label', 'q-label', q.label);
    label.id = id + '-label';
    if (q.type !== 'dropdown') label.htmlFor = id;
    if (q.required) {
      var star = el('span', 'req', ' *');
      star.setAttribute('aria-hidden', 'true');
      label.appendChild(star);
    }
    wrap.appendChild(label);

    var describedBy = [];
    if (q.description) {
      var desc = el('p', 'q-desc', q.description);
      desc.id = id + '-desc';
      describedBy.push(desc.id);
      wrap.appendChild(desc);
    }

    var input;
    var choices = null;
    if (q.type === 'long text') {
      input = el('textarea', q.wordLimit ? 'long' : '');
      input.rows = q.wordLimit ? 7 : 4;
    } else if (q.type === 'dropdown') {
      // A hidden select keeps the value; the visible lettered buttons drive it.
      input = el('select', 'choice-source');
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
      var first = el('option', null, 'Choose one');
      first.value = '';
      input.appendChild(first);
      q.options.forEach(function (o) {
        var opt = el('option', null, o);
        opt.value = o;
        input.appendChild(opt);
      });
      choices = el('div', 'choices');
      choices.setAttribute('role', 'radiogroup');
      choices.setAttribute('aria-labelledby', label.id);
      q.options.forEach(function (o, n) {
        var b = el('button', 'choice');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', 'false');
        b.dataset.value = o;
        b.appendChild(el('span', 'choice-key', String.fromCharCode(65 + n))).setAttribute('aria-hidden', 'true');
        b.appendChild(el('span', 'choice-text', o));
        b.addEventListener('click', function () { pickChoice(q.key, o, true); });
        choices.appendChild(b);
      });
    } else {
      input = el('input');
      input.type = q.type === 'email' ? 'email' : 'text';
      if (q.type === 'number') {
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
      }
    }
    input.id = id;
    input.name = q.key;
    if (input.tagName !== 'SELECT') {
      input.maxLength = CAPS[q.type] || 1000;
      if (q.placeholder) input.placeholder = q.placeholder;
    }
    if (q.required) (choices || input).setAttribute('aria-required', 'true');
    wrap.appendChild(input);
    if (choices) wrap.appendChild(choices);

    var other = null;
    if (q.type === 'dropdown' && q.options.indexOf(SELF_DESCRIBE) !== -1) {
      other = el('input', 'other');
      other.type = 'text';
      other.name = q.key + 'Other';
      other.maxLength = 60;
      other.placeholder = 'Please describe';
      other.setAttribute('aria-label', q.label + ', self-description');
      other.hidden = true;
      wrap.appendChild(other);
    }

    var counter = null;
    if (q.wordLimit) {
      counter = el('p', 'counter');
      wrap.appendChild(counter);
    }

    var error = el('p', 'field-error');
    error.id = id + '-err';
    describedBy.push(error.id);
    (choices || input).setAttribute('aria-describedby', describedBy.join(' '));
    wrap.appendChild(error);

    controls[q.key] = { q: q, wrap: wrap, input: input, choices: choices, other: other, counter: counter, error: error };
    keys.push(q.key);
    box.appendChild(wrap);
    updateCounter(q.key);
  }

  // Show the hidden select's value on the lettered buttons, and the self-describe box when it applies.
  function syncChoices(key) {
    var c = controls[key];
    if (!c || !c.choices) return;
    Array.prototype.forEach.call(c.choices.children, function (b) {
      var on = b.dataset.value === c.input.value;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (c.other) c.other.hidden = c.input.value !== SELF_DESCRIBE;
  }

  var advanceTimer = null;
  function pickChoice(key, value, advance) {
    var c = controls[key];
    c.input.value = value;
    syncChoices(key);
    c.input.dispatchEvent(new Event('change', { bubbles: true }));   // clears errors and saves the draft
    clearTimeout(advanceTimer);
    if (value === SELF_DESCRIBE && c.other) {
      c.other.focus();
      return;
    }
    // Like Typeform: a choice moves on by itself after a beat (except on the last question).
    if (advance && state.step < keys.length - 1) {
      advanceTimer = setTimeout(function () {
        if (keys[state.step] === key) next();
      }, REDUCED_MOTION ? 150 : 420);
    }
  }

  // ---------- One question at a time ----------
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  function isEmptyAnswer(key) {
    return !String(controls[key].input.value || '').trim();
  }

  function showStep(i, backwards) {
    if (!keys.length) return;
    clearTimeout(advanceTimer);
    i = Math.max(0, Math.min(keys.length - 1, i));
    state.step = i;
    keys.forEach(function (k, n) {
      var w = controls[k].wrap;
      w.classList.toggle('is-current', n === i);
      w.classList.toggle('from-above', n === i && !!backwards);
      w.setAttribute('aria-hidden', n === i ? 'false' : 'true');
    });
    var total = keys.length;
    var pct = Math.round(((i + 1) / total) * 100);
    $('progressFill').style.width = pct + '%';
    $('progress').setAttribute('aria-valuenow', String(pct));
    $('progressText').textContent = (i + 1) + ' of ' + total;
    $('backBtn').hidden = i === 0;
    var last = i === total - 1;
    $('nextBtn').hidden = last;
    $('submitBtn').hidden = !last;
    updateNextLabel();
    updateHint();

    // Keep the question in view and put the cursor in it.
    var top = $('nomForm').getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.4) {
      $('nomForm').scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' });
    }
    var c = controls[keys[i]];
    var target = c.choices ? (c.choices.querySelector('.is-selected') || c.wrap) : c.input;
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
  }

  // An optional question left blank says "Skip" instead of "Next".
  function updateNextLabel() {
    var k = keys[state.step];
    if (!k) return;
    var skip = !controls[k].q.required && isEmptyAnswer(k);
    $('nextBtn').textContent = skip ? 'Skip' : 'Next';
  }

  function updateHint() {
    var c = controls[keys[state.step]];
    if (!c) return;
    var last = state.step === keys.length - 1;
    var verb = last ? 'submit' : 'continue';
    var hint;
    if (c.choices) hint = 'Press a letter to choose' + (last ? '' : ', <kbd>Enter &crarr;</kbd> to continue');
    else if (c.input.tagName === 'TEXTAREA') hint = 'Press <kbd>' + (IS_MAC ? '&#8984;' : 'Ctrl') + ' + Enter &crarr;</kbd> to ' + verb;
    else hint = 'Press <kbd>Enter &crarr;</kbd> to ' + verb;
    $('keyHint').innerHTML = hint;
  }

  function next() {
    var k = keys[state.step];
    if (!k) return;
    var msg = checkAnswer(k, collect());
    if (msg) {
      var e = {};
      e[k] = msg;
      showErrors(e, true);
      return;
    }
    showErrors({});
    saveDraftNow();
    showStep(state.step + 1, false);
  }

  function back() {
    if (state.step > 0) showStep(state.step - 1, true);
  }

  // After a draft is restored, pick up at the first required question still blank.
  function resumeStep() {
    var i;
    for (i = 0; i < keys.length; i++) {
      if (controls[keys[i]].q.required && isEmptyAnswer(keys[i])) return i;
    }
    for (i = 0; i < keys.length; i++) {
      if (isEmptyAnswer(keys[i])) return i;
    }
    return keys.length - 1;
  }

  function onFormKey(e) {
    if (e.isComposing || state.busy) return;
    var c = controls[keys[state.step]];
    if (!c) return;
    var t = e.target;
    var last = state.step === keys.length - 1;
    var go = function () { e.preventDefault(); if (last) submit(); else next(); };

    if (e.key === 'Enter') {
      if (t.tagName === 'TEXTAREA') {
        if (e.ctrlKey || e.metaKey) go();
        return;                                       // plain Enter makes a new line
      }
      if (t.tagName === 'BUTTON' && t.type !== 'submit' && !t.classList.contains('choice')) return;   // Back, Switch account
      if (t.classList && t.classList.contains('choice')) {
        e.preventDefault();
        pickChoice(c.q.key, t.dataset.value, true);
        return;
      }
      if (t.tagName === 'INPUT' || t === c.wrap) go();
      return;
    }

    // Letter keys pick a choice, unless the visitor is typing in a box.
    if (c.choices && !e.ctrlKey && !e.metaKey && !e.altKey && /^[a-z]$/i.test(e.key) &&
        t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') {
      var b = c.choices.children[e.key.toUpperCase().charCodeAt(0) - 65];
      if (b) {
        e.preventDefault();
        b.focus();
        pickChoice(c.q.key, b.dataset.value, true);
      }
    }
  }

  function updateCounter(key) {
    var c = controls[key];
    if (!c || !c.counter) return;
    var n = countWords(c.input.value);
    c.counter.textContent = n + ' / ' + c.q.wordLimit + ' words';
    c.counter.classList.toggle('over', n > c.q.wordLimit);
  }

  function collect() {
    var data = {};
    keys.forEach(function (k) {
      var c = controls[k];
      data[k] = c.input.value;
      if (c.other) data[k + 'Other'] = c.other.value;
    });
    return data;
  }

  function fill(data) {
    keys.forEach(function (k) {
      var c = controls[k];
      if (data[k] !== undefined) c.input.value = data[k];
      if (c.other) c.other.value = data[k + 'Other'] || '';
      syncChoices(k);
      updateCounter(k);
    });
    updateNextLabel();
  }

  function formIsEmpty() {
    var data = collect();
    return Object.keys(data).every(function (k) { return !String(data[k]).trim(); });
  }

  function resetForm() {
    $('nomForm').reset();
    keys.forEach(function (k) {
      syncChoices(k);
      updateCounter(k);
    });
    showErrors({});
    $('formError').textContent = '';
    $('draftStatus').textContent = '';
    showStep(0);
  }

  // ---------- Validation ----------
  function checkAnswer(k, data) {
    var q = controls[k].q;
    var v = String(data[k] || '').trim();
    if (!v) return q.required ? (q.type === 'dropdown' ? 'Please choose an answer.' : 'This question is required.') : '';
    if (q.type === 'number' && (!/^\d{1,3}$/.test(v) || +v < 1 || +v > 120)) return 'Enter a whole number between 1 and 120.';
    if (q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
    if (q.type === 'dropdown' && v === SELF_DESCRIBE && !String(data[k + 'Other'] || '').trim()) return 'Please describe, or choose another option.';
    if (q.wordLimit) {
      var n = countWords(v);
      if (n > q.wordLimit) return 'Please keep this to ' + q.wordLimit + ' words or fewer. It is ' + n + ' words now.';
    }
    return '';
  }

  function validate(data) {
    var errs = {};
    keys.forEach(function (k) {
      var msg = checkAnswer(k, data);
      if (msg) errs[k] = msg;
    });
    return errs;
  }

  // Marks the questions with errors. With jump, it goes to the first of them
  // (or, when only the current one is wrong, keeps the cursor there).
  function showErrors(errs, jump) {
    var first = -1;
    keys.forEach(function (k, n) {
      var c = controls[k];
      var msg = errs[k] || '';
      c.error.textContent = msg;
      c.wrap.classList.toggle('invalid', !!msg);
      (c.choices || c.input).setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg && first < 0) first = n;
    });
    if (!jump || first < 0) return;
    if (first !== state.step) showStep(first, first < state.step);
    else {
      var c = controls[keys[first]];
      var target = c.choices ? c.wrap : c.input;
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  // ---------- Drafts: saved to the signed-in Google account, with a backup copy in this browser ----------
  var storage = (function () {
    try {
      var t = '__t';
      window.localStorage.setItem(t, t);
      window.localStorage.removeItem(t);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  })();
  var draftTimer = null;     // browser copy, shortly after typing stops
  var serverTimer = null;    // account copy, a few seconds after typing stops
  var lastServerJson = '';   // what the account already has, so unchanged drafts aren't re-sent
  var SERVER_DELAY = 3000;

  function draftKey() { return state.user ? DRAFT_PREFIX + state.user.email : ''; }

  function readLocalDraft() {
    if (!storage || !state.user) return null;
    try {
      var d = JSON.parse(storage.getItem(draftKey()) || 'null');
      if (!d) return null;
      return d.answers ? d : { answers: d, savedAt: 0 };   // older drafts stored the answers only
    } catch (e) {
      return null;
    }
  }

  function saveDraftNow() {
    clearTimeout(draftTimer);
    if (!state.user) return;
    var empty = formIsEmpty();
    if (storage) {
      try {
        if (empty) storage.removeItem(draftKey());
        else storage.setItem(draftKey(), JSON.stringify({ savedAt: Date.now(), answers: collect() }));
      } catch (e) { /* storage full or blocked: the account copy still works */ }
    }
    if (empty) $('draftStatus').textContent = '';
    scheduleAccountSave();
  }
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 800);
  }

  function draftJson() { return JSON.stringify(formIsEmpty() ? {} : collect()); }
  function tokenUsable() { return !!state.token && Date.now() < state.tokenExp - 30 * 1000; }

  function scheduleAccountSave() {
    clearTimeout(serverTimer);
    serverTimer = setTimeout(saveDraftToAccount, SERVER_DELAY);
  }

  function saveDraftToAccount() {
    clearTimeout(serverTimer);
    if (!state.user || state.busy || !tokenUsable()) return;
    var json = draftJson();
    if (json === lastServerJson) return;
    var sentFor = state.user.email;
    apiPost({ action: 'saveDraft', idToken: state.token, answers: JSON.parse(json) }).then(function (res) {
      if (!state.user || state.user.email !== sentFor || !res || !res.ok) return;
      lastServerJson = json;
      if (json !== '{}' && draftJson() === json) $('draftStatus').textContent = 'Draft saved to your Google account';
    }).catch(function () { /* offline: the browser copy is still there and the next save retries */ });
  }

  // When the page is closed or hidden, send any unsaved draft without waiting for a reply.
  function flushDraftOnLeave() {
    if (!state.user) return;
    saveDraftNow();
    clearTimeout(serverTimer);
    if (state.busy || !tokenUsable() || !navigator.sendBeacon) return;
    var json = draftJson();
    if (json === lastServerJson) return;
    try {
      navigator.sendBeacon(CFG.API_URL, JSON.stringify({ action: 'saveDraft', idToken: state.token, answers: JSON.parse(json) }));
      lastServerJson = json;
    } catch (e) { /* ignore */ }
  }

  // Use whichever draft is newer: the one saved to the account, or the one in this browser.
  function restoreDraft(accountDraft) {
    var local = readLocalDraft();
    var useAccount = accountDraft && accountDraft.answers &&
      (!local || (accountDraft.updatedAt || 0) >= (local.savedAt || 0));
    var answers = useAccount ? accountDraft.answers : (local && local.answers);
    if (!answers) return;
    fill(answers);
    if (useAccount) {
      lastServerJson = draftJson();
      $('draftStatus').textContent = 'We restored your draft from your Google account';
    } else {
      $('draftStatus').textContent = 'We restored your unsent draft from this device';
      scheduleAccountSave();   // copy it to the account too
    }
  }

  function clearDraft() {
    clearTimeout(draftTimer);
    clearTimeout(serverTimer);
    if (storage && state.user) {
      try { storage.removeItem(draftKey()); } catch (e) { /* ignore */ }
    }
    lastServerJson = '{}';   // the server deletes the account draft when a nomination is submitted
    $('draftStatus').textContent = '';
  }

  // ---------- Google sign-in ----------
  function whenGsiReady(fn) {
    var tries = 0;
    (function check() {
      if (window.google && google.accounts && google.accounts.id) return fn();
      if (++tries > 150) {
        $('signinError').textContent = 'Google sign-in could not load. Check that your browser or an extension is not blocking accounts.google.com, then refresh.';
        return;
      }
      setTimeout(check, 100);
    })();
  }

  function initGsi() {
    google.accounts.id.initialize({
      client_id: CFG.GOOGLE_CLIENT_ID,
      callback: onCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    renderGsiButton($('gsiButton'));
  }

  function renderGsiButton(target) {
    target.textContent = '';
    google.accounts.id.renderButton(target, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'left',
      locale: 'en',  // always English, whatever the visitor's phone language is
      width: Math.min(320, Math.max(200, target.clientWidth || 320)),
    });
  }

  function onCredential(resp) {
    var token = resp && resp.credential;
    var claims = decodeJwt(token);
    if (!claims) {
      $('signinError').textContent = 'Sign-in did not work. Please try again.';
      return;
    }
    state.token = token;
    state.tokenExp = (claims.exp || 0) * 1000;
    $('signinError').textContent = '';

    var wasPending = state.pendingSubmit;
    var previousEmail = state.user ? state.user.email : '';
    var formVisible = !$('nomForm').hidden;

    show('signin', false);
    show('reauth', false);
    if (!formVisible) setLoading('Signing you in...');

    apiPost({ action: 'session', idToken: token }).then(function (res) {
      setLoading('');
      if (!res.ok) {
        state.pendingSubmit = false;
        if (res.code === 'AUTH') return backToSignIn('We could not confirm your Google sign-in. Please try again.');
        return backToSignIn(res.message || 'Sign-in did not work. Please try again.');
      }

      if (!state.user || state.user.email !== res.email) lastServerJson = '';
      state.user = { email: res.email, name: res.name };
      renderAccount();
      renderMine(res.myNominations);

      if (!res.canSubmit) {
        state.pendingSubmit = false;
        return showLimit(res.limitTitle, res.limitMessage);
      }

      show('limitNotice', false);
      show('done', false);
      var restored = false;
      if (formIsEmpty()) {
        restoreDraft(res.draft);
        restored = !formIsEmpty();
      }
      show('nomForm', true);
      if (!formVisible) {
        window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
        showStep(restored ? resumeStep() : 0);
      }

      state.pendingSubmit = false;
      if (wasPending && previousEmail === res.email) submit();
      else if (wasPending) $('formError').textContent = 'You signed in with a different account. Check your answers, then press Submit.';
    }).catch(function (err) {
      console.error(err);
      setLoading('');
      state.pendingSubmit = false;
      backToSignIn('We could not reach the server. Check your connection and try again.');
    });
  }

  function backToSignIn(message) {
    state.token = '';
    state.tokenExp = 0;
    state.user = null;
    ['account', 'mine', 'limitNotice', 'nomForm', 'done', 'reauth'].forEach(function (id) { show(id, false); });
    show('signin', true);
    $('signinError').textContent = message || '';
  }

  function askReauth() {
    state.pendingSubmit = true;
    show('reauth', true);
    renderGsiButton($('gsiReauth'));
    $('reauth').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function switchAccount() {
    saveDraftNow();
    saveDraftToAccount();
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    resetForm();
    backToSignIn('');
  }

  // ---------- Submit ----------
  function setBusy(on) {
    state.busy = on;
    var btn = $('submitBtn');
    btn.disabled = on;
    btn.textContent = on ? 'Submitting...' : 'Submit nomination';
  }

  function submit() {
    if (state.busy) return;
    clearTimeout(advanceTimer);
    var data = collect();
    var errs = validate(data);
    showErrors(errs, true);
    if (Object.keys(errs).length) {
      var left = Object.keys(errs).length;
      $('formError').textContent = left === 1 ? 'One question still needs an answer.' : left + ' questions still need answers. We took you to the first one.';
      return;
    }
    $('formError').textContent = '';

    // Google sign-in tokens last about an hour. Ask again before it runs out.
    if (!state.token || Date.now() > state.tokenExp - 60 * 1000) return askReauth();

    clearTimeout(serverTimer);
    setBusy(true);
    apiPost({ action: 'submit', idToken: state.token, answers: data }).then(function (res) {
      setBusy(false);
      if (res.ok) return onSubmitted(res, data);
      if (res.code === 'AUTH') return askReauth();
      if (res.code === 'INVALID') {
        showErrors(res.errors || {}, true);
        $('formError').textContent = res.message || 'Please check this answer.';
        return;
      }
      if (res.code === 'CLOSED' || res.code === 'LIMIT') {
        saveDraftNow();
        return showLimit(res.code === 'CLOSED' ? 'Nominations are closed' : 'You can no longer submit', res.message);
      }
      $('formError').textContent = res.message || 'Something went wrong. Please try again.';
    }).catch(function (err) {
      console.error(err);
      setBusy(false);
      $('formError').textContent = 'We could not reach the server. Check your connection and press Submit again. Your answers are still here.';
    });
  }

  function onSubmitted(res, data) {
    clearDraft();
    renderMine(res.myNominations);
    var name = String(data.nomineeName || '').trim();
    $('doneHeading').textContent = name ? 'Thank you for nominating ' + name + '.' : 'Thank you for your nomination.';
    var msg = (state.config && state.config.confirmationMessage) || '';
    if (res.emailSent) msg += (msg ? ' ' : '') + 'We sent a copy of your answers to ' + state.user.email + '.';
    $('doneMessage').textContent = msg;
    $('doneRef').textContent = res.id;
    show('anotherBtn', !!res.canSubmitAgain);
    show('nomForm', false);
    show('done', true);
    $('done').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('done').focus({ preventScroll: true });
  }

  function nominateAnother() {
    show('done', false);
    show('nomForm', true);
    resetForm();   // also returns to the first question
  }

  // ---------- Events ----------
  function onFieldInput(e) {
    var name = e.target && e.target.name;
    if (!name) return;
    var key = controls[name] ? name : name.replace(/Other$/, '');
    var c = controls[key];
    if (c) {
      updateCounter(key);
      if (c.error.textContent) {
        c.error.textContent = '';
        c.wrap.classList.remove('invalid');
        c.input.setAttribute('aria-invalid', 'false');
      }
    }
    $('formError').textContent = '';
    updateNextLabel();
    saveDraftSoon();
  }

  // ---------- Start ----------
  function boot() {
    var form = $('nomForm');
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    form.addEventListener('input', onFieldInput);
    form.addEventListener('change', onFieldInput);
    form.addEventListener('keydown', onFormKey);
    $('nextBtn').addEventListener('click', next);
    $('backBtn').addEventListener('click', back);
    $('switchBtn').addEventListener('click', switchAccount);
    beginButtons().forEach(function (b) { b.addEventListener('click', begin); });
    $('anotherBtn').addEventListener('click', nominateAnother);
    window.addEventListener('pagehide', flushDraftOnLeave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushDraftOnLeave();
    });

    if (!CFG.API_URL || /PASTE/.test(CFG.API_URL) || !CFG.GOOGLE_CLIENT_ID || /PASTE/.test(CFG.GOOGLE_CLIENT_ID)) {
      return fatal('This portal is not set up yet. Fill in config.js with the web app URL and the Google client ID.');
    }

    apiGet({ action: 'config' }).then(function (cfg) {
      if (!cfg || !cfg.ok) throw new Error((cfg && cfg.message) || 'Bad config response');
      state.config = cfg;
      renderHero(cfg);
      if (cfg.open) buildForm(cfg.questions || []);
      onStage(function () {
        setLoading('');
        if (!cfg.open) {
          $('closedMessage').textContent = cfg.closedMessage || '';
          return show('closed', true);
        }
        show('signin', true);
        whenGsiReady(initGsi);
      });
    }).catch(function (err) {
      console.error(err);
      fatal('We could not load the nomination form. Please refresh the page in a minute.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
