const routes = new Map([
  ['/', ['overview', 'Overview']],
  ['/reception', ['reception', 'Reception']],
  ['/leaderboard', ['leaderboard', 'Leaderboard']],
  ['/devices', ['devices', 'Diagnostics']],
  ['/screen-settings', ['screen-settings', 'Screens']],
  ['/media', ['media', 'Media']],
  ['/automations', ['automations', 'Automations']],
]);

function showPage(focus = false) {
  const [page, title] = routes.get(location.pathname) ?? routes.get('/');
  for (const section of document.querySelectorAll('[data-page]')) section.hidden = section.dataset.page !== page;
  const heading = document.getElementById('page-title');
  if (heading) heading.textContent = title;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.pathname === location.pathname) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  window.dispatchEvent(new CustomEvent('pagechange', { detail: { page } }));
  document.title = `${title} · Adventure Rooms`;
  if (focus) {
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      link.target || link.hasAttribute('download') || link.origin !== location.origin || link.hash || link.search || !routes.has(link.pathname)) return;
  event.preventDefault();
  if (location.pathname !== link.pathname) history.pushState(null, '', link.pathname);
  showPage(true);
});
window.addEventListener('popstate', () => showPage(true));
showPage();
