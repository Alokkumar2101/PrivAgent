/**
 * PrivAgent :: Visual Masking
 *
 * FIXED VERSION.
 *
 * Root-cause bug (previous version): maskField() reparented the real
 * <input> into a wrapper <span> via insertBefore/appendChild, and mutated
 * el.style directly. Reparenting a live, framework-controlled input (React/
 * Vue/Angular forms in particular) desyncs the framework's virtual DOM from
 * the real DOM. The framework's next re-render (which happens on every
 * keystroke in a controlled input) then fails to reconcile against a tree
 * it no longer recognizes, which is what made password/login fields
 * "become unusable." Mutating el.style was a secondary violation of the
 * "never touch the live input" requirement.
 *
 * FIX:
 *  - The real element is NEVER moved, reparented, wrapped, or restyled.
 *    Badges are floating, position-tracked <div>s appended to
 *    document.body, positioned via getBoundingClientRect(). They visually
 *    sit ABOVE the field (not over it) and are pointer-events:none, so
 *    they can never intercept clicks/typing/focus.
 *  - Authentication-grade fields (password, otp, pin, cvv, api_key,
 *    auth_token, credit_card) get NO visual badge at all — only counted
 *    internally for the dashboard. This satisfies the "never overlay an
 *    authentication field" requirement even beyond what a non-blocking
 *    floating badge would already guarantee.
 *  - dataset.privagentClassified is still set on the element as a plain
 *    data-* attribute. This does not affect rendering, layout, focus, or
 *    form submission in any way — it's purely an internal bookkeeping flag
 *    so we don't double-count/double-render on repeated scans.
 */

(function (global) {
  'use strict';

  const MASK_CLASS = 'privagent-mask-badge';
  let active = false;
  let badges = []; // { badge?, el, type, reposition?, hidden }

  // Fields in this set NEVER get a visual overlay, period — only tracked
  // internally for dashboard counts. This matches the "must remain
  // completely functional and untouched" requirement for auth-grade data.
  const NO_OVERLAY_TYPES = new Set([
    'password', 'otp', 'pin', 'cvv', 'api_key', 'auth_token', 'credit_card'
  ]);

  function labelFor(type) {
    const map = {
      email: 'EMAIL', password: 'PASSWORD', name: 'NAME', phone: 'PHONE',
      address: 'ADDRESS', credit_card: 'CARD', otp: 'OTP', pin: 'PIN',
      cvv: 'CVV', api_key: 'API KEY', auth_token: 'TOKEN', unknown: 'PII'
    };
    return map[type] || 'PII';
  }

  function positionBadge(badge, el) {
    const rect = el.getBoundingClientRect();
    badge.style.top = (window.scrollY + rect.top - 22) + 'px';
    badge.style.left = (window.scrollX + rect.left) + 'px';
  }

  function maskField(el, type, confidence) {
    if (el.dataset.privagentClassified === 'true') return;
    el.dataset.privagentClassified = 'true'; // bookkeeping only — no visual/behavioral effect

    if (NO_OVERLAY_TYPES.has(type)) {
      // Authentication-grade field: classify and count only. The live
      // input is never touched, wrapped, styled, or covered.
      badges.push({ el, type, hidden: true });
      return;
    }

    const badge = document.createElement('div');
    badge.className = MASK_CLASS;
    badge.textContent = `\uD83D\uDD12 ${labelFor(type)} \u2022 LOCAL ONLY`;
    badge.title = `Detected as ${type} (confidence ${(confidence * 100).toFixed(0)}%). Value stays in your browser.`;
    Object.assign(badge.style, {
      position: 'absolute',
      fontSize: '10px',
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontWeight: '700',
      letterSpacing: '0.3px',
      color: '#00E5FF',
      background: 'rgba(6, 20, 30, 0.92)',
      border: '1px solid rgba(0, 229, 255, 0.5)',
      borderRadius: '4px',
      padding: '2px 6px',
      zIndex: 2147483647,
      pointerEvents: 'none', // can never intercept clicks/focus on the field
      whiteSpace: 'nowrap',
      boxShadow: '0 0 6px rgba(0,229,255,0.35)'
    });

    // Appended to <body>, never to el's parent. el itself is untouched.
    document.body.appendChild(badge);
    positionBadge(badge, el);

    const reposition = () => positionBadge(badge, el);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    badges.push({ badge, el, type, reposition });
  }

  function unmaskAll() {
    badges.forEach(({ badge, reposition }) => {
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      if (reposition) {
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
      }
    });
    // Clear the bookkeeping flag so a future scan can re-classify fields.
    badges.forEach(({ el }) => { delete el.dataset.privagentClassified; });
    badges = [];
    active = false;
  }

  function showGlobalStatus(piiCount) {
    let banner = document.getElementById('privagent-status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'privagent-status-banner';
      Object.assign(banner.style, {
        position: 'fixed',
        top: '12px',
        right: '12px',
        zIndex: 2147483647,
        background: 'linear-gradient(135deg, #061421 0%, #0b2536 100%)',
        border: '1px solid rgba(0,229,255,0.5)',
        borderRadius: '10px',
        padding: '10px 14px',
        color: '#E6FBFF',
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontSize: '12px',
        boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
        maxWidth: '240px',
        pointerEvents: 'none'
      });
      document.body.appendChild(banner);
    }
    banner.innerHTML = `<div style="font-weight:700;color:#00E5FF;margin-bottom:2px;">\uD83D\uDEE1 PRIVAGENT ACTIVE</div>
      <div>${piiCount} PII PROTECTED</div>`;
  }

  function hideGlobalStatus() {
    const banner = document.getElementById('privagent-status-banner');
    if (banner) banner.remove();
  }

  function scanAndMask() {
    const results = global.PrivAgentPII.scanDocument();
    results.forEach((r) => maskField(r.element, r.type, r.confidence));
    active = results.length > 0 || active;
    showGlobalStatus(results.length);
    return results;
  }

  function toggle() {
    if (active) {
      unmaskAll();
      hideGlobalStatus();
      return { active: false, count: 0 };
    } else {
      const results = scanAndMask();
      active = true;
      return { active: true, count: results.length };
    }
  }

  global.PrivAgentMasking = { scanAndMask, unmaskAll, toggle, showGlobalStatus, hideGlobalStatus };
})(window);
