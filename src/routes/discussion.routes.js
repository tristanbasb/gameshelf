import express from 'express';
import { config } from '../config.js';
import { conversation, repondre, ErreurDiscussion } from '../discussion.js';

const router = express.Router();

/** Un message tient en quelques lignes ; au-dela, c'est un collage accidentel. */
const MESSAGE_MAX = 4000;

/*
 * Sans rien a dire pendant que Claude reflechit ou cherche, une connexion peut
 * etre coupee par un intermediaire : un commentaire part a intervalle regulier.
 */
const PING_MS = 15_000;

/**
 * POST /api/chat : `{ conversation, message }`. La reponse est un flux
 * d'evenements serveur : `conversation` (identifiant, modele), `text`, `activity`,
 * `sources`, puis `done` ou `error`. Une conversation oubliee (redemarrage du
 * service) repond 404 avant tout flux : l'interface en recommence une.
 */
router.post('/chat', async (req, res) => {
  if (!config.anthropicApiKey) {
    return res.status(503).json({
      error: 'Discussion desactivee : renseignez ANTHROPIC_API_KEY dans le fichier .env',
    });
  }
  const texte = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!texte) return res.status(400).json({ error: 'Message vide' });
  if (texte.length > MESSAGE_MAX) {
    return res.status(413).json({ error: `Message trop long (${MESSAGE_MAX} caracteres au plus)` });
  }

  const id = typeof req.body?.conversation === 'string' ? req.body.conversation : '';
  const conv = conversation(id);
  if (!conv) {
    return res.status(404).json({ error: 'Conversation oubliee par le serveur', forgotten: true });
  }
  if (conv.occupee) {
    return res.status(409).json({ error: 'Claude repond deja dans cette conversation' });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  // no-transform : la compression retiendrait les morceaux au lieu de les
  // laisser partir un a un.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const envoyer = (evenement, donnees) => {
    if (!res.writableEnded) res.write(`event: ${evenement}\ndata: ${JSON.stringify(donnees)}\n\n`);
  };
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, PING_MS);

  // Le navigateur a ferme la connexion (bouton Arreter, fenetre fermee) :
  // inutile de laisser Claude ecrire pour personne.
  const interruption = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) interruption.abort();
  });

  envoyer('conversation', { id: conv.id, model: conv.modele.nom });
  try {
    await repondre(conv, texte, envoyer, interruption.signal);
    envoyer('done', {});
  } catch (err) {
    if (!interruption.signal.aborted) {
      const message = err instanceof ErreurDiscussion ? err.message : 'Erreur interne du serveur';
      if (!(err instanceof ErreurDiscussion)) console.error('[erreur] Discussion :', err);
      envoyer('error', { error: message });
    }
  } finally {
    clearInterval(ping);
    res.end();
  }
});

export default router;
