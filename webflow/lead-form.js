/* ============================================================
   Webflow lead form — custom code (reference implementation)
   Paste inside <script> ... </script> in
   Site settings > Custom code > Footer code (or a page's "Before </body>").

   What it does on every Webflow form:
     1. Fills hidden fields: event_page, formName and first-touch UTM values
        (utmCampaignName / utmCampaignSource / utmCampaignMedium).
     2. Phase 2 — checks the email with the Debounce API before submit and
        blocks invalid, disposable and spam-trap addresses
        (optionally free providers and catch-all domains).
     3. Posts the fields to the intake web app (apps-script/intake/Intake.gs),
        then lets Webflow finish its own submit (success message, redirects).

   If Debounce is slow or down, the form is NOT blocked (fails open).

   Replace the two placeholders below. Never commit your real values.
   ============================================================ */

(function (root) {
  'use strict';

  var CONFIG = {
    INTAKE_URL: 'REPLACE_WITH_INTAKE_WEB_APP_URL',      // https://script.google.com/macros/s/.../exec
    DEBOUNCE_PUBLIC_KEY: 'REPLACE_WITH_DEBOUNCE_PUBLIC_KEY', // public (client-side) key, domain-restricted
    DEBOUNCE_TIMEOUT_MS: 4000,
    BLOCK_FREE_PROVIDERS: false, // true = reject gmail.com, yahoo.com, ...
    BLOCK_CATCH_ALL: false,      // true = reject accept-all domains (code 4)
    FORM_SELECTOR: 'form[data-name]',
    EMAIL_FIELD: 'email',
    MESSAGES: {
      syntax: 'Please enter a valid email address.',
      invalid: 'This email address can’t receive mail. Please use another one.',
      disposable: 'Please use your work email, not a temporary address.',
      free: 'Please use your work email address.',
      catchAll: 'Please use a personal work address we can reach.'
    }
  };

  /* ---------- pure helpers (unit-tested) ---------- */

  // Debounce result codes: https://debounce.io/resources/help-desk/understanding-results/result-codes/
  //   1 syntax · 2 spam trap · 3 disposable · 4 accept-all · 5 deliverable
  //   6 invalid · 7 unknown · 8 role
  function interpretDebounce(result, options) {
    var opts = options || CONFIG;
    if (!result || !result.debounce) return { ok: true, reason: 'unavailable' };

    var d = result.debounce;
    var code = String(d.code || '');
    var free = String(d.free_email || '').toLowerCase() === 'true';

    if (code === '1') return { ok: false, reason: 'syntax' };
    if (code === '2' || code === '6') return { ok: false, reason: 'invalid' };
    if (code === '3') return { ok: false, reason: 'disposable' };
    if (code === '4' && opts.BLOCK_CATCH_ALL) return { ok: false, reason: 'catchAll' };
    if (free && opts.BLOCK_FREE_PROVIDERS) return { ok: false, reason: 'free' };
    return { ok: true, reason: code === '5' ? 'deliverable' : 'allowed' };
  }

  function isValidSyntax(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
  }

  // First-touch UTM: keep the values from the first page of the visit.
  function readUtm(search, stored) {
    var params = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
      var v = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
      params[k] = v;
    });
    var fresh = {
      utmCampaignName: params.utm_campaign || '',
      utmCampaignSource: params.utm_source || '',
      utmCampaignMedium: params.utm_medium || ''
    };
    var hasFresh = fresh.utmCampaignName || fresh.utmCampaignSource || fresh.utmCampaignMedium;
    if (stored && (stored.utmCampaignName || stored.utmCampaignSource || stored.utmCampaignMedium)) {
      return stored;
    }
    return hasFresh ? fresh : { utmCampaignName: '', utmCampaignSource: '', utmCampaignMedium: '' };
  }

  function debounceUrl(email, key) {
    return 'https://api.debounce.io/v1/?api=' + encodeURIComponent(key) +
      '&email=' + encodeURIComponent(email);
  }

  /* ---------- browser wiring ---------- */

  function storedUtm() {
    try { return JSON.parse(sessionStorage.getItem('leadUtm') || 'null'); } catch (e) { return null; }
  }
  function saveUtm(utm) {
    try { sessionStorage.setItem('leadUtm', JSON.stringify(utm)); } catch (e) { /* private mode */ }
  }

  function setHidden(form, name, value) {
    var input = form.querySelector('input[name="' + name + '"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
  }

  function showError(form, text) {
    var box = form.querySelector('.lead-email-error');
    if (!box) {
      box = document.createElement('div');
      box.className = 'lead-email-error';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'color:#A32D2D;font-size:14px;margin-top:8px;';
      var field = form.querySelector('[name="' + CONFIG.EMAIL_FIELD + '"]');
      (field && field.parentNode ? field.parentNode : form).appendChild(box);
    }
    box.textContent = text || '';
    box.style.display = text ? 'block' : 'none';
  }

  function checkEmail(email) {
    if (!CONFIG.DEBOUNCE_PUBLIC_KEY || CONFIG.DEBOUNCE_PUBLIC_KEY.indexOf('REPLACE_') === 0) {
      return Promise.resolve({ ok: true, reason: 'not-configured' });
    }
    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve(null); }, CONFIG.DEBOUNCE_TIMEOUT_MS);
    });
    var call = fetch(debounceUrl(email, CONFIG.DEBOUNCE_PUBLIC_KEY))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return Promise.race([call, timeout]).then(function (res) {
      return interpretDebounce(res, CONFIG);
    });
  }

  function sendToIntake(form) {
    if (CONFIG.INTAKE_URL.indexOf('REPLACE_') === 0) return Promise.resolve();
    var body = new URLSearchParams(new FormData(form));
    // no-cors: Apps Script web apps don't send CORS headers; the row is still written.
    return fetch(CONFIG.INTAKE_URL, { method: 'POST', mode: 'no-cors', body: body })
      .catch(function () { /* never block the visitor */ });
  }

  function wire(form) {
    var utm = readUtm(location.search, storedUtm());
    saveUtm(utm);
    setHidden(form, 'event_page', document.title);
    setHidden(form, 'formName', form.getAttribute('data-name') || '');
    setHidden(form, 'utmCampaignName', utm.utmCampaignName);
    setHidden(form, 'utmCampaignSource', utm.utmCampaignSource);
    setHidden(form, 'utmCampaignMedium', utm.utmCampaignMedium);

    form.addEventListener('submit', function (event) {
      if (form.dataset.leadChecked === 'yes') {      // second pass: let Webflow submit
        form.dataset.leadChecked = '';
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();

      var field = form.querySelector('[name="' + CONFIG.EMAIL_FIELD + '"]');
      var email = field ? field.value.trim() : '';
      var button = form.querySelector('[type="submit"]');

      if (field && !isValidSyntax(email)) {
        showError(form, CONFIG.MESSAGES.syntax);
        return;
      }

      if (button) button.disabled = true;
      showError(form, '');

      (field ? checkEmail(email) : Promise.resolve({ ok: true }))
        .then(function (verdict) {
          if (!verdict.ok) {
            showError(form, CONFIG.MESSAGES[verdict.reason] || CONFIG.MESSAGES.invalid);
            return;
          }
          return sendToIntake(form).then(function () {
            form.dataset.leadChecked = 'yes';
            if (form.requestSubmit) form.requestSubmit(); else form.submit();
          });
        })
        .then(function () { if (button) button.disabled = false; });
    }, true);
  }

  var api = {
    CONFIG: CONFIG,
    interpretDebounce: interpretDebounce,
    isValidSyntax: isValidSyntax,
    readUtm: readUtm,
    debounceUrl: debounceUrl
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;                       // tests (Node)
  } else if (root && root.document) {
    var start = function () {
      Array.prototype.forEach.call(document.querySelectorAll(CONFIG.FORM_SELECTOR), wire);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    root.LeadForm = api;
  }
})(typeof window !== 'undefined' ? window : this);
