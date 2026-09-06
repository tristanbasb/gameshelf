import express from 'express';
import { config } from '../config.js';

const router = express.Router();

const RAWG_BASE = 'https://api.rawg.io/api';
const TIMEOUT_MS = 8000;

function requireApiKey(_req, res, next) {
  if (!config.rawgApiKey) {
    return res.status(503).json({
      error: 'Recherche en ligne desactivee : renseignez RAWG_API_KEY dans le fichier .env',
    });
  }
  next();
}

async function rawgFetch(pathname, params = {}) {
  const url = new URL(`${RAWG_BASE}${pathname}`);
  url.searchParams.set('key', config.rawgApiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const err = new Error(`RAWG a repondu ${response.status}`);
    err.status = response.status === 401 ? 502 : 502;
    throw err;
  }
  return response.json();
}

const names = (list) => (Array.isArray(list) ? list.map((item) => item?.name).filter(Boolean) : []);

/** Recherche de jeux : renvoie une liste de suggestions pre-formatees. */
router.get('/external/search', requireApiKey, async (req, res, next) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.status(400).json({ error: 'Requete trop courte' });

  try {
    const data = await rawgFetch('/games', { search: query, page_size: '10' });
    res.json({
      results: (data.results || []).map((game) => ({
        external_id: game.id,
        title: game.name,
        release_year: game.released ? Number.parseInt(game.released.slice(0, 4), 10) : null,
        cover_url: game.background_image || '',
        platforms: (game.platforms || []).map((p) => p?.platform?.name).filter(Boolean),
        metacritic: game.metacritic ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Fiche detaillee : ajoute developpeur, editeur et description. */
router.get('/external/game/:id', requireApiKey, async (req, res, next) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide' });

  try {
    const game = await rawgFetch(`/games/${id}`);
    res.json({
      title: game.name || '',
      cover_url: game.background_image || '',
      platforms: (game.platforms || []).map((p) => p?.platform?.name).filter(Boolean),
      // Les genres RAWG servent de suggestion de tags.
      tags: names(game.genres).slice(0, 5).join(', '),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
