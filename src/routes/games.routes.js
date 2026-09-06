import express from 'express';
import {
  listGames,
  getGame,
  createGame,
  updateGame,
  deleteGame,
  getMeta,
  getStats,
} from '../games.js';

const router = express.Router();

const parseId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

router.get('/games', (req, res) => {
  res.json(listGames(req.query));
});

router.get('/games/:id', (req, res) => {
  const id = parseId(req.params.id);
  const game = id && getGame(id);
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });
  res.json(game);
});

router.post('/games', (req, res) => {
  res.status(201).json(createGame(req.body || {}));
});

router.put('/games/:id', (req, res) => {
  const id = parseId(req.params.id);
  const game = id && updateGame(id, req.body || {});
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });
  res.json(game);
});

/** Bascule rapide du drapeau favori depuis la grille. */
router.post('/games/:id/favorite', (req, res) => {
  const id = parseId(req.params.id);
  const existing = id && getGame(id);
  if (!existing) return res.status(404).json({ error: 'Jeu introuvable' });
  res.json(updateGame(id, { favorite: existing.favorite ? 0 : 1 }));
});

router.delete('/games/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id || !deleteGame(id)) return res.status(404).json({ error: 'Jeu introuvable' });
  res.json({ ok: true });
});

router.get('/meta', (_req, res) => {
  res.json(getMeta());
});

router.get('/stats', (_req, res) => {
  res.json(getStats());
});

export default router;
