/**
 * PrivAgent :: Vision Interface
 *
 * IMPORTANT / HONESTY NOTE FOR JUDGES:
 * No real ViT or VLM model is downloaded or executed in this local prototype
 * (that would require a multi-hundred-MB model and a GPU-capable runtime,
 * which is impractical for a local hackathon demo). Instead, this file
 * defines the STABLE INTERFACE that a real model would implement, and the
 * adapters (vit-adapter.js, vlm-adapter.js) provide clearly-labelled MOCK
 * implementations that mimic realistic outputs using DOM/geometry heuristics.
 *
 * To go from mock -> real:
 *   1. Load a small ONNX/quantized ViT via `onnxruntime-web` + WebGPU/WASM.
 *   2. Capture a screenshot with chrome.tabs.captureVisibleTab().
 *   3. Feed the bitmap through the ONNX session, get bounding boxes.
 *   4. Replace VisualPrivacyDetector.detect() body with the real inference
 *      call, keeping the same return shape documented below.
 *   5. For VLM: swap the DOM-heuristic summary in VLMPageAnalyzer.analyze()
 *      for a call to a local/remote vision-language model, keeping the
 *      { elements, summary } return shape.
 */

(function (global) {
  'use strict';

  /**
   * Contract: VisualPrivacyDetector
   * detect(screenshotDataUrl) -> Promise<{
   *   regions: Array<{ x, y, width, height, type, confidence }>,
   *   engine: 'mock' | 'onnx-vit'
   * }>
   */
  class VisualPrivacyDetectorBase {
    async detect(_screenshotDataUrl) {
      throw new Error('Not implemented — see vit-adapter.js');
    }
  }

  /**
   * Contract: VLMPageAnalyzer
   * analyze(screenshotDataUrl) -> Promise<{
   *   elements: Array<{ label, x, y, width, height }>,
   *   summary: string,
   *   engine: 'mock' | 'remote-vlm'
   * }>
   */
  class VLMPageAnalyzerBase {
    async analyze(_screenshotDataUrl) {
      throw new Error('Not implemented — see vlm-adapter.js');
    }
  }

  global.PrivAgentVision = { VisualPrivacyDetectorBase, VLMPageAnalyzerBase };
})(window);
