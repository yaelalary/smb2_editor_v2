/**
 * Shared drag state — set by library components on dragstart, read by
 * the canvas on dragover so it can render a live ghost preview of the
 * actual sprite (at the canvas's palette) instead of letting the
 * browser show its default drag image (the library thumbnail + label).
 *
 * The HTML5 dataTransfer is only readable on drop per spec — we need
 * the id during dragover. Hence this module-scoped ref.
 */

import { ref } from 'vue';

export interface DragInfo {
  kind: 'item' | 'enemy';
  id: number;
}

/** Active payload while a library drag is in flight; null otherwise. */
export const activeDrag = ref<DragInfo | null>(null);

/**
 * Replace the default drag image (the thumbnail + label the browser
 * would otherwise snapshot) with a 1×1 transparent pixel. Called from
 * each library's dragstart so only the canvas ghost shows up.
 */
let transparentPixel: HTMLImageElement | null = null;
function getTransparentPixel(): HTMLImageElement {
  if (!transparentPixel) {
    transparentPixel = new Image(1, 1);
    transparentPixel.src =
      'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  }
  return transparentPixel;
}

export function hideNativeDragImage(e: DragEvent): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setDragImage(getTransparentPixel(), 0, 0);
}
