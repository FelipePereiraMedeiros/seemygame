/** mapping: commands receive explicit compatibility ports; no page initialization. */
export function normalizeTargetRect(compatibilityContext, rect) {
  if (!rect || typeof rect !== 'object') return null;
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || width > 32768 || height > 32768) {
    return null;
  }
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

export function applyRadialDeadzone(compatibilityContext, x, y, deadzone = 0.08) {
  const clampedX = Math.max(-1, Math.min(1, Number(x) || 0));
  const clampedY = Math.max(-1, Math.min(1, Number(y) || 0));
  const magnitude = Math.hypot(clampedX, clampedY);
  if (magnitude <= deadzone) {
    return { x: 0, y: 0 };
  }
  const normalizedMagnitude = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  const factor = normalizedMagnitude / magnitude;
  return {
    x: Math.round(clampedX * factor * 1000) / 1000,
    y: Math.round(clampedY * factor * 1000) / 1000
  };
}
