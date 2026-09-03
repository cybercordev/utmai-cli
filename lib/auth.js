const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const config = require('./config');

/**
 * Login în browser pentru UTM AI CLI (OAuth device + PKCE pe API-ul nostru).
 *
 *   1. CLI-ul deschide o cerere: trimite `code_challenge` și — dacă are browser local — o adresă de
 *      întoarcere pe loopback, ca fila să se închidă singură la final.
 *   2. Omul aprobă în browser, autentificat cu contul lui (parolă sau Microsoft).
 *   3. CLI-ul întreabă serverul din câteva în câteva secunde și primește cheia.
 *
 * Verificatorul PKCE nu părăsește procesul ăsta: cine interceptează codul de utilizator sau adresa
 * de întoarcere tot nu poate ridica cheia.
 */

function base64url(buf) {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function postJson(apiUrl, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, apiUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Serverul nu răspunde (30s)')); });
    req.write(payload);
    req.end();
  });
}

function getJson(apiUrl, path, apiKey) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, apiUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const headers = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const req = mod.request(url, { method: 'GET', headers, timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Serverul nu răspunde (30s)')); });
    req.end();
  });
}

/** Mașină fără browser: SSH, sau Linux fără sesiune grafică. Atunci arătăm doar adresa. */
function hasBrowser() {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return false;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  return true;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const DONE_PAGE = (title, text) => `<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8">
<title>${title} — UTM AI</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;background:#eef1fb;color:#2a2740;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.c{background:#fff;padding:38px 42px;border-radius:20px;box-shadow:0 16px 40px -12px rgba(0,58,92,.35);text-align:center;max-width:380px}
h1{font-size:19px;margin:0 0 8px;color:#1f1d33}p{font-size:14px;color:#5a5572;line-height:1.5;margin:0}
@media (prefers-color-scheme:dark){body{background:#0b0d1a;color:#e8e7f3}.c{background:#1c1c2e}h1{color:#f3f2fb}p{color:#b4b0cc}}
</style></head><body><div class="c"><h1>${title}</h1><p>${text}</p></div></body></html>`;

/**
 * Serverul local pe care aterizează browserul după aprobare. Nu primește niciun secret — doar un
 * `status` — deci nu are ce să scape pe aici; e strict pentru confortul de a nu rămâne cu fila
 * deschisă. Ascultă doar pe 127.0.0.1.
 */
function startLoopbackServer() {
  return new Promise((resolve, reject) => {
    // `hit` se rezolvă când browserul chiar a ajuns aici. Fără el, procesul se putea închide cu cheia
    // în mână ÎNAINTE ca fila să navigheze (pagina așteaptă ~o secundă), iar utilizatorul rămânea cu o
    // eroare de conexiune pe 127.0.0.1 după un login perfect reușit.
    let markHit;
    const hit = new Promise((r) => { markHit = r; });
    const server = http.createServer((req, res) => {
      const status = new URL(req.url, 'http://127.0.0.1').searchParams.get('status');
      const denied = status === 'denied';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(denied
        ? DONE_PAGE('Cerere refuzată', 'Nu s-a emis nicio cheie. Poți închide fila.')
        : DONE_PAGE('Autentificat', 'Întoarce-te în terminal — CLI-ul e gata de lucru. Poți închide fila.'));
      markHit();
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, hit, redirectUri: `http://127.0.0.1:${port}/callback` });
    });
  });
}

/** Cât așteptăm browserul să aterizeze pe pagina locală, după ce cheia e deja în mână. */
const LOOPBACK_LANDING_TIMEOUT_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ERRORS = {
  access_denied: 'Cererea a fost refuzată din browser sau accesul API e restricționat pentru contul tău.',
  expired_token: 'Cererea a expirat (10 minute). Pornește din nou autentificarea.',
  consumed: 'Cererea a fost deja folosită.',
  invalid_grant: 'Cerere invalidă — pornește din nou autentificarea.',
  invalid_request: 'Cerere invalidă — pornește din nou autentificarea.',
};

/**
 * Rulează fluxul complet. `onEvent` primește pașii, ca partea de afișare să rămână în renderer.
 * Întoarce credențialele salvate.
 */
async function loginWithBrowser({ apiUrl, useBrowser = true, deviceName, onEvent = () => {} } = {}) {
  const settings = config.loadSettings();
  const base = apiUrl || settings.apiUrl;
  const { verifier, challenge } = makePkce();

  let loopback = null;
  if (useBrowser && hasBrowser()) {
    try { loopback = await startLoopbackServer(); } catch { loopback = null; }
  }

  try {
    const started = await postJson(base, '/api/cli/auth/device', {
      code_challenge: challenge,
      redirect_uri: loopback ? loopback.redirectUri : undefined,
      hostname: (deviceName && String(deviceName).trim().slice(0, 60)) || settings.deviceName,
      client_name: 'UTM AI CLI',
    });

    if (started.status === 404) {
      throw new Error('Serverul nu cunoaște login-ul din browser (API vechi). Folosește o cheie API.');
    }
    if (started.status !== 200 || !started.body || !started.body.device_code) {
      throw new Error((started.body && started.body.message) || `Serverul a răspuns ${started.status}.`);
    }

    const { device_code: deviceCode, user_code: userCode, verification_uri_complete: uriComplete,
      verification_uri: uri, expires_in: expiresIn, interval } = started.body;

    const opened = loopback ? openBrowser(uriComplete) : false;
    onEvent({ type: 'prompt', userCode, url: uriComplete || uri, opened });

    const deadline = Date.now() + (expiresIn || 600) * 1000;
    const waitMs = Math.max(1, interval || 2) * 1000;

    while (Date.now() < deadline) {
      await sleep(waitMs);
      const res = await postJson(base, '/api/cli/auth/token', {
        device_code: deviceCode,
        code_verifier: verifier,
      });

      if (res.status === 200 && res.body && res.body.token) {
        const creds = {
          apiKey: res.body.token,
          username: res.body.username || null,
          keyId: res.body.key_id || null,
          keyName: res.body.key_name || null,
          expiresAt: res.body.expires_at || null,
          obtainedAt: new Date().toISOString(),
        };
        config.saveCredentials(creds);

        // Am deschis noi browserul ⇒ fila e pe drum spre loopback. Îi lăsăm timp să ajungă, altfel
        // procesul moare sub ea. Dacă utilizatorul a aprobat de pe alt calculator, nu vine nimeni —
        // de aia așteptarea e plafonată și pornește doar când chiar am deschis un browser local.
        if (loopback && opened) {
          await Promise.race([loopback.hit, sleep(LOOPBACK_LANDING_TIMEOUT_MS)]);
        }

        onEvent({ type: 'done', credentials: creds });
        return creds;
      }

      const err = res.body && res.body.error;
      if (err === 'authorization_pending') continue;
      if (res.status === 429) { await sleep(waitMs * 2); continue; }
      throw new Error(ERRORS[err] || `Autentificare eșuată (${res.status}).`);
    }

    throw new Error(ERRORS.expired_token);
  } finally {
    if (loopback) {
      // Aici putem închide imediat: dacă browserul trebuia să ajungă, deja a ajuns (vezi `hit` mai sus).
      // `closeAllConnections` taie și keep-alive-urile, altfel serverul ține procesul viu în REPL.
      try { loopback.server.closeAllConnections?.(); } catch {}
      try { loopback.server.close(); } catch {}
    }
  }
}

/** Salvează o cheie lipită de mână, după ce o verifică la server (altfel salvăm o cheie moartă). */
async function loginWithApiKey(key, { apiUrl } = {}) {
  const base = apiUrl || config.loadSettings().apiUrl;
  const trimmed = String(key || '').trim();
  if (!trimmed.startsWith('utmai_')) throw new Error('Cheia trebuie să înceapă cu „utmai_".');

  const res = await getJson(base, '/api/cli/auth/whoami', trimmed);
  if (res.status === 401) throw new Error('Cheie invalidă sau expirată.');
  if (res.status === 403) throw new Error('Acces API restricționat pentru acest cont.');
  if (res.status === 404) {
    // API vechi, fără endpointul de verificare — salvăm cheia așa cum e cerută.
    const creds = { apiKey: trimmed, obtainedAt: new Date().toISOString() };
    config.saveCredentials(creds);
    return creds;
  }
  if (res.status !== 200) throw new Error(`Serverul a răspuns ${res.status}.`);

  const creds = {
    apiKey: trimmed,
    username: (res.body && res.body.username) || null,
    keyName: (res.body && res.body.key_name) || null,
    expiresAt: (res.body && res.body.expires_at) || null,
    obtainedAt: new Date().toISOString(),
  };
  config.saveCredentials(creds);
  return creds;
}

/** Starea sesiunii, verificată la server. `null` dacă nu există cheie locală. */
async function whoami({ apiUrl } = {}) {
  const { apiKey, source } = config.loadCredentials();
  if (!apiKey) return null;
  const base = apiUrl || config.loadSettings().apiUrl;
  const res = await getJson(base, '/api/cli/auth/whoami', apiKey);
  if (res.status === 200) return { ...res.body, source, ok: true };
  return { ok: false, status: res.status, source, error: (res.body && res.body.error) || null };
}

module.exports = { loginWithBrowser, loginWithApiKey, whoami, hasBrowser, makePkce };
