function selectPanel() {
  const name = location.hash.slice(1) || 'files';
  const panels = [...document.querySelectorAll('[data-panel]')];
  const found = panels.some(panel => panel.dataset.panel === name);
  panels.forEach(panel => { panel.hidden = panel.dataset.panel !== (found ? name : 'files'); });
  document.querySelectorAll('[data-tab]').forEach(tab => {
    const active = tab.dataset.tab === (found ? name : 'files');
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
}
selectPanel();
window.addEventListener('hashchange', selectPanel);
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.open).showModal()));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('[data-auto-open]').forEach(dialog => dialog.showModal());
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => {
  const input = document.getElementById('command'); input.value = button.dataset.command; input.focus();
}));
document.querySelectorAll('form').forEach(form => form.addEventListener('submit', () => {
  // Do not disable clicked named buttons: their action value is part of the submitted request.
  form.setAttribute('aria-busy', 'true');
}));
