/**
 * PrivAgent :: Action Executor (content-script / DOM-level actions)
 * Executes ONLY pre-validated action objects. Tab-level actions (navigate,
 * open/close tab, back/forward/refresh) are handled by the background
 * service worker via chrome.tabs — this module handles in-page actions:
 * scroll, click, focus, type, read_page, summarize_page.
 */

(function (global) {
  'use strict';

  function findTarget(descriptor) {
    if (!descriptor) return null;
    const text = descriptor.toLowerCase().trim();

    // Try id/name match first
    let el = document.querySelector(`#${CSS.escape(descriptor)}`) ||
             document.querySelector(`[name="${CSS.escape(descriptor)}"]`);
    if (el) return el;

    // Try matching visible text on buttons/links
    const candidates = [...document.querySelectorAll('button, a, input[type=submit], input[type=button], [role=button]')];
    el = candidates.find((c) => (c.innerText || c.value || '').toLowerCase().includes(text));
    if (el) return el;

    // Try matching label/placeholder for inputs
    const inputs = [...document.querySelectorAll('input, textarea')];
    el = inputs.find((i) => {
      const label = (i.placeholder || i.getAttribute('aria-label') || i.name || i.id || '').toLowerCase();
      return label.includes(text);
    });
    return el || null;
  }

  function executeDomAction(action) {
    const { type, payload } = action;
    switch (type) {
      case 'scroll': {
        const amount = payload.direction === 'up' ? -500 : 500;
        window.scrollBy({ top: amount, behavior: 'smooth' });
        return { success: true, message: `Scrolled ${payload.direction}` };
      }
      case 'click': {
        const el = findTarget(payload.target);
        if (!el) return { success: false, message: `No element found matching "${payload.target}"` };
        el.click();
        return { success: true, message: `Clicked "${payload.target}"` };
      }
      case 'focus': {
        const el = findTarget(payload.target);
        if (!el) return { success: false, message: `No element found matching "${payload.target}"` };
        el.focus();
        return { success: true, message: `Focused "${payload.target}"` };
      }
      case 'type': {
        const el = findTarget(payload.target);
        if (!el) return { success: false, message: `No input found matching "${payload.target}"` };
        el.focus();
        el.value = payload.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, message: `Typed into "${payload.target}"` };
      }
      case 'read_page': {
        const text = document.body.innerText.slice(0, 1200);
        const sanitized = global.PrivAgentSanitizer ? global.PrivAgentSanitizer.sanitizeText(text) : text;
        return { success: true, message: 'Read page (sanitized)', data: sanitized };
      }
      case 'summarize_page': {
        const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 5).map((h) => h.innerText.trim()).filter(Boolean);
        return { success: true, message: 'Summarized page', data: { title: document.title, headings } };
      }
      case 'submit':
      case 'login':
      case 'send': {
        const form = document.querySelector('form');
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit();
          return { success: true, message: 'Form submitted' };
        }
        return { success: false, message: 'No submittable form found on this page' };
      }
      default:
        return { success: false, message: `Action "${type}" is not a DOM-level action` };
    }
  }

  global.PrivAgentActionExecutor = { executeDomAction, findTarget };
})(window);
