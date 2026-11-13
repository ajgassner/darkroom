// Scrolling to newly started runs: their live cards appear at the top of the gallery.

/** Scroll position that puts an element (top in page coordinates) right below the sticky bars covering it. */
export function revealTop(elementTop: number, coveredBy: number, gap = 12): number {
  return Math.max(0, Math.round(elementTop - coveredBy - gap));
}

/**
 * Scroll to the top of the gallery, below the sticky elements (`data-sticky`: the top bar and, on wide screens, the
 * composer). On narrow screens the side panel sits above the gallery, so scrolling to the page top would hide it.
 */
export function revealGallery() {
  requestAnimationFrame(() => {
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    const covered = [...document.querySelectorAll<HTMLElement>('[data-sticky]')]
      .filter((el) => getComputedStyle(el).position === 'sticky')
      .reduce((sum, el) => sum + el.offsetHeight, 0);
    const top = revealTop(gallery.getBoundingClientRect().top + window.scrollY, covered);
    window.scrollTo({ top, behavior: 'smooth' });
  });
}
