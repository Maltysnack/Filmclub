import { useRef } from "react";

/**
 * Long press hook — returns pointer event handlers to spread onto any element.
 * - callback fires after `delay` ms of stationary press (cancels if pointer moves >10px)
 * - `cancel()` can be called imperatively (e.g. when a drag starts)
 * - `consumeFired()` returns true (and resets) if a long press just fired — use at the
 *   start of onClick to swallow the tap that follows a long press
 */
export function useLongPress(callback: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  // Keep callback in a ref so stale closures always call the latest version
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  function cancel() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function consumeFired() {
    if (firedRef.current) {
      firedRef.current = false;
      return true;
    }
    return false;
  }

  const handlers = {
    onPointerDown(e: React.PointerEvent) {
      firedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        timerRef.current = null;
        callbackRef.current();
      }, delay);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onPointerMove(e: React.PointerEvent) {
      if (!startRef.current || !timerRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 10) cancel();
    },
  };

  return { handlers, cancel, consumeFired };
}
