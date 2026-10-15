/*
 * Theme, applique avant le premier affichage.
 *
 * Ce script est charge de facon bloquante dans <head>, et c'est voulu : il
 * pose le theme avant que la page ne soit peinte. Sans lui, un theme clair
 * choisi a la main s'afficherait d'abord sombre, puis basculerait.
 *
 * Trois reglages : « dark », « light », ou « auto » qui suit le systeme.
 */
(() => {
  let choix = 'auto';
  try {
    choix = localStorage.getItem('gv-theme') || 'auto';
  } catch {
    /* stockage indisponible : on suit le systeme */
  }
  const clair = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = choix === 'auto' ? (clair ? 'light' : 'dark') : choix;
  document.documentElement.dataset.themeChoice = choix;
})();
