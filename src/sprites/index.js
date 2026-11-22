/**
 * Replaceable presentation layer. v1 is HTML overlays.
 * Pixi and Live2D presenters are reserved and not constructed here.
 */
import { createHtmlPresenter } from "./html.js";

export { createHtmlPresenter };

export function createPresenter(type, layer, options = {}) {
  const kind = type || options.catalog?.presenter || "html";
  if (kind === "pixi" || kind === "live2d") {
    // Reserved. WebGL is unreliable on this box; v1 always uses HTML.
    return createHtmlPresenter(layer, options);
  }
  return createHtmlPresenter(layer, options);
}
