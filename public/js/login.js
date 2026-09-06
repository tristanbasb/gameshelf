import { api } from './api.js';
import { store } from './ui.js';

const form = document.getElementById('login-form');
const errorBox = document.getElementById('error');
const submit = document.getElementById('submit');

// Applique le theme choisi precedemment.
const savedTheme = store.get('gameshelf-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Connexion…';

  try {
    await api.login(
      document.getElementById('username').value,
      document.getElementById('password').value,
    );
    window.location.href = '/';
  } catch (err) {
    errorBox.textContent = err.message || 'Connexion impossible';
    errorBox.hidden = false;
    document.getElementById('password').value = '';
    document.getElementById('password').focus();
  } finally {
    submit.disabled = false;
    submit.textContent = 'Se connecter';
  }
});
