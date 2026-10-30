import express from 'express';
import { config } from '../config.js';
import { choisirModeles, modelesChoisis } from '../modeles.js';

const router = express.Router();

/**
 * PUT /api/models : `{ identify, chat }`, l'un ou l'autre. Renvoie le modele
 * retenu pour chaque usage. La liste des modeles est dans /api/config.
 */
router.put('/models', (req, res) => {
  if (!config.anthropicApiKey) {
    return res.status(503).json({
      error: 'Claude desactive : renseignez ANTHROPIC_API_KEY dans le fichier .env',
    });
  }
  const erreur = choisirModeles(req.body);
  if (erreur) return res.status(400).json({ error: erreur });
  return res.json(modelesChoisis());
});

export default router;
