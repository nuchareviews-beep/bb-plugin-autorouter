/**
 * The routing status is shown in the composer's provider/model picker rather
 * than under the composer, because that button is where the user's attention
 * already is: it is the control whose value Auto Router is about to decide.
 * The picker label is driven entirely by CSS `content`, so the animated text
 * has to reach it as a string, not as React children.
 */
export const SELECTING_LABEL_BASE = "Selecting a model for the job";

export const SELECTING_LABEL_MIN_DOTS = 1;
export const SELECTING_LABEL_MAX_DOTS = 3;

/** How long each dot count is held before the next one. */
export const SELECTING_LABEL_INTERVAL_MS = 400;

/**
 * `tick` counts elapsed intervals and grows without bound; the dot count wraps
 * so the caller never has to reset it.
 */
export function selectingLabelDots(tick: number): string {
  const span = SELECTING_LABEL_MAX_DOTS - SELECTING_LABEL_MIN_DOTS + 1;
  const offset = ((Math.trunc(tick) % span) + span) % span;
  return ".".repeat(SELECTING_LABEL_MIN_DOTS + offset);
}

/**
 * Under `prefers-reduced-motion` the cycling dots are the whole animation, so
 * they collapse to a static ellipsis instead of being animated more slowly.
 */
export function selectingLabel(tick: number, reducedMotion = false): string {
  return reducedMotion
    ? `${SELECTING_LABEL_BASE}…`
    : `${SELECTING_LABEL_BASE}${selectingLabelDots(tick)}`;
}

/**
 * CSS `content` takes a quoted string, and the label is delivered through a
 * custom property, so the quotes have to survive into the property value.
 */
export function toCssContentString(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}
