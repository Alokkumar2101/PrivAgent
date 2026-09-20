/**
 * PrivAgent :: Privacy Engine
 * Turns PrivAgentDetector's raw candidates into deduplicated,
 * metadata-only state (safe to message to the background worker — raw
 * values never appear in its output), and owns the ONLY code path
 * allowed to add a visual masking badge. Badges are floating overlays
 * appended to document.body and never touch, move, or restyle the real
 * input — and authentication/financial-grade fields never get a badge
 * at all, regardless of the masking toggle.
 */

(function (root) {
  'use strict';

  const CONFIDENCE_THRESHOLDS = {
    email: 0.55, phone: 0.55, password: 0.5, otp: 0.55, pin: 0.55,
    cvv: 0.55, credit_card: 0.6, gov_id: 0.6, auth_token: 0.55,
    api_key: 0.55, name: 0.7, address: 0.55
  };

  // Once detected, these are policy-"Protected" (never displayed/stored/
  // sent) regardless of the masking toggle, and NEVER get a visual overlay.
  const ALWAYS_PROTECTED_NO_OVERLAY = new Set([
    'password', 'otp', 'pin', 'cvv', 'api_key', 'auth_token', 'credit_card', 'gov_id'
  ]);

  // "Protected" only when PII Masking is ON — and the only types that ever get a badge.
  const MASKABLE_TYPES = new Set(['email', 'phone', 'name', 'address']);

  function stableId(el, type, index) {
    const identity = el.name || el.id || `idx${index}`;
    return `${location.hostname}${location.pathname}::${identity}::${type}`;
  }

  function computeState(maskingEnabled) {
    const raw = root.PrivAgentDetector.scanDocument();
    const seen = new Map();
    raw.forEach((r) => {
      const threshold = CONFIDENCE_THRESHOLDS[r.type] ?? 0.55;
      if (r.confidence < threshold) return;
      const id = stableId(r.element, r.type, r.index);
      if (!seen.has(id)) {
        const isProtected = ALWAYS_PROTECTED_NO_OVERLAY.has(r.type) ||
          (MASKABLE_TYPES.has(r.type) && maskingEnabled);
        seen.set(id, { id, type: r.type, confidence: r.confidence, element: r.element, protected: isProtected });
      }
    });
    const counts = {}, protectedCounts = {}, items = [];
    for (const entry of seen.values()) {
      counts[entry.type] = (counts[entry.type] || 0) + 1;
      if (entry.protected) protectedCounts[entry.type] = (protectedCounts[entry.type] || 0) + 1;
      items.push(entry);
    }
    return { counts, protectedCounts, items, totalDetected: items.length, totalProtected: items.filter((i) => i.protected).length };
  }

  function toMessageSafe(state) {
    return {
      counts: state.counts, protectedCounts: state.protectedCounts,
      totalDetected: state.totalDetected, totalProtected: state.totalProtected,
      ids: state.items.map((i) => ({ id: i.id, type: i.type, protected: i.protected }))
    };
  }

  // ---------------- Non-destructive visual masking ----------------
  const MASK_CLASS = 'privagent-mask-badge';
  let badges = [];

  function labelFor(type) {
    const map = { email: 'EMAIL', phone: 'PHONE', name: 'NAME', address: 'ADDRESS' };
    return map[type] || 'PII';
  }
  function positionBadge(badge, el) {
    const rect = el.getBoundingClientRect();
    badge.style.top = (window.scrollY + rect.top - 22) + 'px';
    badge.style.left = (window.scrollX + rect.left) + 'px';
  }
  function addBadge(el, type) {
    if (el.dataset.privagentBadged === 'true') return;
    el.dataset.privagentBadged = 'true'; // bookkeeping only — no visual/behavioral effect on el
    const badge = document.createElement('div');
    badge.className = MASK_CLASS;
    badge.textContent = `\u25CF ${labelFor(type)}`; // solid dot, not an emoji lock — matches PrivAgent's icon-free-badge design
    Object.assign(badge.style, {
      position: 'absolute', fontSize: '10px', fontFamily: 'Segoe UI, Arial, sans-serif',
      fontWeight: '700', letterSpacing: '0.3px', color: '#FFD21F',
      background: 'rgba(8, 8, 8, 0.94)', border: '1px solid rgba(255, 210, 31, 0.5)',
      borderRadius: '4px', padding: '2px 6px', zIndex: 2147483647,
      pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: '0 0 6px rgba(255,210,31,0.3)'
    });
    document.body.appendChild(badge); // never appended to el's parent — el is never touched
    positionBadge(badge, el);
    const reposition = () => positionBadge(badge, el);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    badges.push({ badge, el, reposition });
  }
  function clearBadges() {
    badges.forEach(({ badge, el, reposition }) => {
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      delete el.dataset.privagentBadged;
    });
    badges = [];
  }
  function applyMasking(state, maskingEnabled) {
    clearBadges();
    if (!maskingEnabled) return;
    state.items.forEach((item) => { if (MASKABLE_TYPES.has(item.type)) addBadge(item.element, item.type); });
  }

  root.PrivAgentEngine = {
    CONFIDENCE_THRESHOLDS, ALWAYS_PROTECTED_NO_OVERLAY, MASKABLE_TYPES,
    computeState, toMessageSafe, applyMasking, clearBadges
  };
})(typeof self !== 'undefined' ? self : window);
