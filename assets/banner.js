document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.gift-banner').forEach((banner) => {
    const toggle = banner.querySelector('.gift-banner__mobile-menu');
    const panel = banner.querySelector('.gift-banner__mobile-panel');

    if (!toggle || !panel) return;

    toggle.addEventListener('click', () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';

      toggle.setAttribute('aria-expanded', String(!isExpanded));
      banner.classList.toggle('is-mobile-panel-open', !isExpanded);
      panel.hidden = isExpanded;
    });
  });
});
