/*
 * Gestes de l'application, accessibles depuis toutes les fenetres.
 *
 * La fiche ouvre le formulaire, le bilan applique un filtre, le scanner
 * ouvre une fiche : plutot que d'importer les modules les uns dans les
 * autres, chacun passe par cet objet, que app.js remplit au demarrage.
 */
export const actions = {
  openDetail: () => {},
  openEditor: () => {},
  openScanner: () => {},
  openStats: () => {},
  openMenu: () => {},
  openTransfer: () => {},
  openFilters: () => {},
  /** Remplace les filtres (et la recherche) par ceux donnes. */
  showOnly: () => {},
  instance: { externalSearch: false, secure: false, version: '' },
};
