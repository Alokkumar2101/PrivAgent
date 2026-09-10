/**
 * PrivAgent :: VLM Adapter (Visual Page Analyzer)
 *
 * MOCK IMPLEMENTATION — clearly labelled as such (engine: 'mock').
 * Approximates "visual page understanding" using DOM structure (buttons,
 * forms, headings, links) instead of a real Vision-Language Model reading
 * a screenshot. This keeps the same interface a real VLM adapter would use.
 *
 * REAL UPGRADE PATH (documented, not required for local demo):
 *   - Use Transformers.js with a small VLM (e.g. a distilled BLIP/LLaVA
 *     variant) running via WebGPU, OR
 *   - Send the screenshot to a self-hosted VLM endpoint (never a third
 *     party by default, to preserve the privacy-first design) and parse
 *     its structured JSON output into the same { elements, summary } shape.
 */

(function (global) {
  'use strict';

  class MockVLMPageAnalyzer extends global.PrivAgentVision.VLMPageAnalyzerBase {
    async analyze(_screenshotDataUrl) {
      const buttons = [...document.querySelectorAll('button, input[type=submit], a.btn, [role=button]')]
        .slice(0, 15)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            label: (el.innerText || el.value || el.getAttribute('aria-label') || 'button').trim().slice(0, 40),
            x: Math.round(rect.left), y: Math.round(rect.top),
            width: Math.round(rect.width), height: Math.round(rect.height)
          };
        });

      const forms = document.querySelectorAll('form').length;
      const inputs = document.querySelectorAll('input, textarea, select').length;
      const headings = [...document.querySelectorAll('h1, h2')].slice(0, 3).map((h) => h.innerText.trim()).filter(Boolean);

      const summary = `Page contains ${forms} form(s), ${inputs} input field(s), and ${buttons.length} actionable control(s).` +
        (headings.length ? ` Key headings: ${headings.join(', ')}.` : '');

      return { elements: buttons, summary, engine: 'mock' };
    }
  }

  global.PrivAgentVLM = new MockVLMPageAnalyzer();
})(window);
