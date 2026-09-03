const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.utmai');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
// Credențialele stau separat de setări, într-un fișier citibil doar de proprietar (0600). Înainte,
// cheia trăia în `config.json` cu drepturile implicite ale umask-ului — adică, pe o mașină partajată,
// lizibilă de oricine.
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

const DEFAULTS = {
  apiUrl: 'https://utmai-api.cybercor.org',
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function readJson(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    // Fișier corupt — îl tratăm ca inexistent.
  }
  return {};
}

/**
 * Numele sub care apare cheia în lista de chei a contului. Implicit e numele mașinii, fiindcă
 * asta e util când ai chei de pe mai multe calculatoare — dar `hostname` poartă adesea numele
 * real al omului sau al firmei (`DESKTOP-98G39QP`, `laptop-ion-popescu`), iar cheia se vede în
 * interfața web. De aceea poate fi înlocuit, fără să se schimbe comportamentul implicit.
 */
function deviceName() {
  const saved = readJson(CONFIG_FILE);
  const chosen = process.env.UTMAI_DEVICE_NAME || saved.deviceName;
  const name = String(chosen || '').trim();
  return name ? name.slice(0, 60) : os.hostname();
}

function loadSettings() {
  const saved = readJson(CONFIG_FILE);
  return {
    apiUrl: process.env.UTMAI_API_URL || saved.apiUrl || DEFAULTS.apiUrl,
    deviceName: deviceName(),
  };
}

/**
 * Credențialele active. `UTMAI_CLI_KEY` bate fișierul (util în CI), iar cheia veche din
 * `config.json` e acceptată ca să nu rupem instalările existente — vezi migrateLegacyKey().
 */
function loadCredentials() {
  if (process.env.UTMAI_CLI_KEY) {
    return { apiKey: process.env.UTMAI_CLI_KEY, source: 'env' };
  }
  const creds = readJson(CREDENTIALS_FILE);
  if (creds.apiKey) return { ...creds, source: 'file' };

  const legacy = readJson(CONFIG_FILE);
  if (legacy.apiKey) return { apiKey: legacy.apiKey, source: 'legacy' };
  return { apiKey: null, source: null };
}

function load() {
  const { apiUrl } = loadSettings();
  const { apiKey } = loadCredentials();
  return { apiUrl, apiKey };
}

function save(data) {
  ensureConfigDir();
  const current = readJson(CONFIG_FILE);
  const merged = { ...current, ...data };
  delete merged.apiKey; // Cheia nu mai are ce căuta aici.
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

/**
 * Scrie credențialele cu 0600. `mode` din writeFileSync se aplică doar la CREARE, deci pentru un
 * fișier care există deja chmod-ul explicit e singurul care garantează drepturile.
 */
function saveCredentials(creds) {
  ensureConfigDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try { fs.chmodSync(CREDENTIALS_FILE, 0o600); } catch {}
}

function clearApiKey() {
  try { if (fs.existsSync(CREDENTIALS_FILE)) fs.unlinkSync(CREDENTIALS_FILE); } catch {}
  const legacy = readJson(CONFIG_FILE);
  if (legacy.apiKey) save({});  // save() taie apiKey din config.json
}

/**
 * Mută o cheie rămasă în `config.json` (instalări dinainte de login-ul prin browser) în fișierul de
 * credențiale. Întoarce true dacă a mutat ceva — CLI-ul o spune o singură dată.
 */
function migrateLegacyKey() {
  const legacy = readJson(CONFIG_FILE);
  if (!legacy.apiKey) return false;
  const existing = readJson(CREDENTIALS_FILE);
  if (!existing.apiKey) saveCredentials({ apiKey: legacy.apiKey, source: 'migrat din config.json' });
  save({});
  return true;
}

module.exports = {
  load,
  loadSettings,
  deviceName,
  loadCredentials,
  save,
  saveCredentials,
  clearApiKey,
  migrateLegacyKey,
  CONFIG_FILE,
  CREDENTIALS_FILE,
};
