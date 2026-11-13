// Scrolling to newly started runs (their live cards appear at the top of the gallery) or to a run shown from
// elsewhere, and keeping the focus in place.

/** Id of the composer's prompt field. */
export const PROMPT_ID = 'prompt';

/** Put the keyboard focus into the prompt field (e.g. when the focused live card of a run disappears). */
export function focusComposer() {
  document.getElementById(PROMPT_ID)?.focus();
}

/** Whether the keyboard focus fell back to the page (e.g. its button disappeared). */
export function focusLost(): boolean {
  return !document.activeElement || document.activeElement === document.body;
}

/** Scroll position that puts an element (top in page coordinates) right below the sticky bars covering it. */
export function revealTop(elementTop: number, coveredBy: number, gap = 12): number {
  return Math.max(0, Math.round(elementTop - coveredBy - gap));
}

/** Height of the sticky elements (`data-sticky`: the top bar and, on wide screens, the composer) covering the page. */
function stickyHeight(): number {
  return [...document.querySelectorAll<HTMLElement>('[data-sticky]')]
    .filter((el) => getComputedStyle(el).position === 'sticky')
    .reduce((sum, el) => sum + el.offsetHeight, 0);
}

/** Scroll smoothly so an element's top sits right below the sticky elements. */
function scrollBelowBars(el: HTMLElement) {
  window.scrollTo({
    top: revealTop(el.getBoundingClientRect().top + window.scrollY, stickyHeight()),
    behavior: 'smooth',
  });
}

/**
 * Scroll to the top of the gallery, below the sticky elements. On narrow screens the side panel sits above the
 * gallery, so scrolling to the page top would hide it.
 */
export function revealGallery() {
  requestAnimationFrame(() => {
    const gallery = document.getElementById('gallery');
    if (gallery) scrollBelowBars(gallery);
  });
}

/** Id of a run's card in the gallery. */
export function runCardId(runId: string): string {
  return `run-${runId}`;
}

/** How long a run shown from elsewhere stays highlighted. */
const HIGHLIGHT_MS = 2400;

/**
 * Show a run in the gallery (e.g. from "Previous uploads"): scroll its card below the sticky elements, give it the
 * keyboard focus and highlight it briefly. False when the gallery does not show that run.
 */
export function revealRun(runId: string): boolean {
  const card = document.getElementById(runCardId(runId));
  if (!card) return false;
  card.focus({ preventScroll: true });
  card.dataset.highlight = 'true';
  setTimeout(() => delete card.dataset.highlight, HIGHLIGHT_MS);
  requestAnimationFrame(() => scrollBelowBars(card));
  return true;
}
