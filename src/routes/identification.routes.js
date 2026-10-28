import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { identifier, ErreurIdentification } from '../identification.js';

const router = express.Router();

/*
 * La photo reste en memoire le temps de l'analyse : elle n'a rien a faire
 * dans les jaquettes, ni sur le disque.
 */
const photo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 6 },
});

function requireApiKey(_req, res, next) {
  if (!config.anthropicApiKey) {
    return res.status(503).json({
      error: 'Identification desactivee : renseignez ANTHROPIC_API_KEY dans le fichier .env',
    });
  }
  next();
}

/**
 * POST /api/identify (multipart) : `photo` (image, facultative), `ean`,
 * `ean_source` (« photo » ou « saisie ») et `serial`, facultatifs. Il faut au
 * moins la photo ou le code-barres. Renvoie la fiche proposee et sa
 * verification ; rien n'est enregistre.
 */
router.post('/identify', requireApiKey, photo.single('photo'), async (req, res, next) => {
  try {
    const ean = String(req.body?.ean ?? '').replace(/[\s-]/g, '');
    if (ean && !/^\d{8,14}$/.test(ean)) {
      return res.status(400).json({ error: 'Code-barres : 8 a 14 chiffres attendus' });
    }
    if (!req.file && !ean) {
      return res.status(400).json({ error: 'Une photo ou un code-barres est necessaire' });
    }
    res.json(await identifier({
      photo: req.file?.buffer ?? null,
      ean,
      eanSource: req.body?.ean_source === 'photo' ? 'photo' : 'saisie',
      serial: String(req.body?.serial ?? '').trim().slice(0, 40),
    }));
  } catch (err) {
    // Photo illisible, quota, service injoignable : des echecs prevus, qui
    // se disent a l'utilisateur sans remplir le journal de piles d'appels.
    if (err instanceof ErreurIdentification) {
      if (err.status >= 500) console.warn(`  ! Identification impossible : ${err.message}`);
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
