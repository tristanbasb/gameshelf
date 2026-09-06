# Dépendances embarquées

Ces fichiers sont copiés tels quels depuis npm et versionnés dans le dépôt :
l'application n'a pas d'étape de build, et doit fonctionner sans accès réseau.

## zxing.min.js

- Paquet : `@zxing/library`
- Version : 0.23.0
- Origine : `node_modules/@zxing/library/umd/index.min.js`
- Licence : Apache-2.0
- Rôle : décodeur de codes-barres, utilisé uniquement quand le navigateur ne
  fournit pas l'API `BarcodeDetector` — Safari sur iPhone, notamment.
  Le fichier n'est chargé qu'à ce moment-là, jamais au démarrage.

Pour le mettre à jour :

```bash
npm pack @zxing/library@<version>
tar -xzf zxing-library-<version>.tgz
cp package/umd/index.min.js public/js/vendor/zxing.min.js
```
