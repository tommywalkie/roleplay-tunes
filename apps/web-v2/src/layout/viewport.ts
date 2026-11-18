/**
 * Installed on an iPhone home screen, some iOS releases give the app a viewport shorter
 * than the screen and draw the rest themselves, while env(safe-area-inset-bottom) still
 * reports the home indicator. Padding by that inset then leaves an empty band under the
 * tab bar. This publishes the missing height as --viewport-shortfall; index.css takes it
 * off the bottom inset. Browser tabs are left alone: their toolbars always make the
 * viewport shorter than the screen.
 */
export function watchViewportShortfall(): void {
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!installed) return;

  const root = document.documentElement;
  const measure = () => {
    const portrait = window.innerHeight >= window.innerWidth;
    const long = Math.max(window.screen.width, window.screen.height);
    const short = Math.min(window.screen.width, window.screen.height);
    const shortfall = Math.max(0, (portrait ? long : short) - window.innerHeight);
    // With a top inset the viewport starts at the top of the screen, so what it misses is
    // at the bottom. Without one, iOS has pushed it down under a solid status bar: the
    // missing part is at the top and the bottom inset is real.
    const topInset = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
    root.style.setProperty('--viewport-shortfall', `${topInset > 0 ? shortfall : 0}px`);
  };
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', measure);
}
