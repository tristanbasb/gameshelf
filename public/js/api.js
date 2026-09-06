/** Petite couche d'acces a l'API JSON de GameShelf. */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });

  // Session expiree : on renvoie l'utilisateur vers la page de connexion.
  if (response.status === 401 && !url.includes('/api/auth/')) {
    window.location.href = '/login';
    throw new ApiError('Session expiree', 401);
  }

  if (response.status === 204) return null;

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && payload.error) ||
      `Erreur ${response.status}`;
    const error = new ApiError(message, response.status);
    if (payload && typeof payload === 'object' && payload.details) error.details = payload.details;
    throw error;
  }

  return payload;
}

const withBody = (method) => (url, body) =>
  request(url, {
    method,
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  });

export const api = {
  get: (url) => request(url),
  post: withBody('POST'),
  put: withBody('PUT'),
  del: (url) => request(url, { method: 'DELETE' }),

  me: () => request('/api/auth/me'),
  login: (username, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) =>
    request('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listGames: (params) => request(`/api/games?${new URLSearchParams(params)}`),
  createGame: (data) => withBody('POST')('/api/games', data),
  updateGame: (id, data) => withBody('PUT')(`/api/games/${id}`, data),
  deleteGame: (id) => request(`/api/games/${id}`, { method: 'DELETE' }),
  toggleFavorite: (id) => request(`/api/games/${id}/favorite`, { method: 'POST' }),

  /** "Est-ce que j'ai deja ce jeu ?" — recherche par code-barres. */
  lookup: (ean) => request(`/api/lookup?ean=${encodeURIComponent(ean)}`),

  meta: () => request('/api/meta'),

  uploadCover: (file) => {
    const form = new FormData();
    form.append('cover', file);
    return request('/api/upload', { method: 'POST', body: form });
  },

  importData: (content, format, mode) =>
    withBody('POST')('/api/import', { content, format, mode }),

  searchExternal: (q) => request(`/api/external/search?q=${encodeURIComponent(q)}`),
  externalGame: (id) => request(`/api/external/game/${id}`),
};
