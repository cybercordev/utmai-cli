#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const client = require('../lib/client');
const config = require('../lib/config');
const auth = require('../lib/auth');
const { toolDefinitions, needsConfirmation } = require('../lib/tools');
const { executeTool } = require('../lib/executor');
const renderer = require('../lib/renderer');

const THINKING_LOG_DIR = path.join(os.homedir(), '.utmai', 'thinking_logs');

function saveThinkingLog(thinking) {
  try {
    if (!fs.existsSync(THINKING_LOG_DIR)) fs.mkdirSync(THINKING_LOG_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const logFile = path.join(THINKING_LOG_DIR, `${date}.log`);
    const timestamp = new Date().toISOString();
    const entry = `\n--- ${timestamp} ---\n${thinking.trim()}\n`;
    fs.appendFileSync(logFile, entry, 'utf-8');
  } catch {}
}

// Filtrează blocurile <think>...</think> din stream
// Returnează { visibleChunk, thinkChunk } și actualizează state
function filterThinkingChunk(raw, state) {
  let visible = '';
  let thinking = '';
  let text = state.partial + raw;
  state.partial = '';

  while (text.length > 0) {
    if (state.inThink) {
      const end = text.indexOf('</think>');
      if (end === -1) {
        // Verifică dacă textul se termină cu un prefix parțial din '</think>'
        const closeTag = '</think>';
        let partialLen = 0;
        for (let i = 1; i < closeTag.length; i++) {
          if (text.endsWith(closeTag.slice(0, i))) { partialLen = i; break; }
        }
        thinking += text.slice(0, text.length - partialLen);
        state.partial = text.slice(text.length - partialLen);
        text = '';
      } else {
        thinking += text.slice(0, end);
        text = text.slice(end + '</think>'.length);
        state.inThink = false;
      }
    } else {
      const start = text.indexOf('<think>');
      if (start === -1) {
        // Verifică prefix parțial din '<think>'
        const openTag = '<think>';
        let partialLen = 0;
        for (let i = 1; i < openTag.length; i++) {
          if (text.endsWith(openTag.slice(0, i))) { partialLen = i; break; }
        }
        visible += text.slice(0, text.length - partialLen);
        state.partial = text.slice(text.length - partialLen);
        text = '';
      } else {
        visible += text.slice(0, start);
        text = text.slice(start + '<think>'.length);
        state.inThink = true;
        if (!state.indicatorShown) {
          state.indicatorShown = true;
        }
      }
    }
  }
  return { visible, thinking };
}

const PLATFORM = process.platform;
const SHELL_INFO = PLATFORM === 'win32'
  ? 'Windows — shell: cmd.exe sau PowerShell. Folosește comenzi Windows (dir, type, del, copy, move). Evită sintaxa bash (grep, ls, cat, sed, awk, 2>/dev/null, |& etc.).'
  : PLATFORM === 'darwin'
    ? 'macOS — shell: bash/zsh.'
    : 'Linux — shell: bash.';

const SYSTEM_MESSAGE = {
  role: 'system',
  content: `Ești un asistent de programare care ajută utilizatorii cu task-uri de dezvoltare software.
Ai acces la tool-uri pentru a citi, scrie și edita fișiere, a executa comenzi shell și a căuta fișiere.
Folosește tool-urile când este necesar pentru a îndeplini cerințele utilizatorului.
Răspunde în română dacă utilizatorul scrie în română, altfel răspunde în limba utilizatorului.
Fii concis și direct.
Sistem: ${SHELL_INFO}`,
};

let conversationHistory = [SYSTEM_MESSAGE];
let currentAbortController = null;

// --- Readline setup ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

function ask(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function askPassword(prompt) {
  return new Promise((resolve) => {
    const orig = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => { if (s === prompt) process.stdout.write(s); };
    rl.question(prompt, (answer) => {
      rl._writeToOutput = orig;
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function askConfirmation(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      const a = answer.trim().toLowerCase();
      resolve(a === 'da' || a === 'd' || a === 'yes' || a === 'y');
    });
  });
}

// --- SSE parsing: acumulează conținut și tool_calls ---
async function processStream(signal) {
  let content = '';
  const toolCalls = {}; // index -> { id, name, arguments }
  let role = 'assistant';
  let firstContent = true;
  let thinkContent = '';
  const thinkState = { inThink: false, partial: '', indicatorShown: false };

  try {
    for await (const event of client.streamChat(conversationHistory, toolDefinitions, signal)) {
      if (event.done) break;

      const choice = event.data?.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;
      if (!delta) continue;

      if (delta.role) role = delta.role;

      // Conținut text — filtrează thinking și afișează în timp real
      if (delta.content) {
        const { visible, thinking } = filterThinkingChunk(delta.content, thinkState);
        thinkContent += thinking;

        if (thinking) {
          if (!thinkState.indicatorShown) {
            process.stdout.write(chalk.dim('\n⟳ gândire'));
            thinkState.indicatorShown = true;
            thinkState.dotCount = 0;
            thinkState.charCount = 0;
          }
          thinkState.charCount += thinking.length;
          const dots = Math.floor(thinkState.charCount / 120) % 4 + 1;
          if (dots !== thinkState.dotCount) {
            thinkState.dotCount = dots;
            process.stdout.write(chalk.dim(`\r⟳ gândire${'.'.repeat(dots)}`));
          }
        }

        if (visible) {
          if (firstContent) {
            if (thinkState.indicatorShown) {
              process.stdout.write('\r\x1b[2K'); // șterge linia cu indicatorul
            }
            process.stdout.write('\n');
            firstContent = false;
          }
          content += visible;
          process.stdout.write(visible);
        }
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls[idx]) {
            toolCalls[idx] = { id: '', name: '', arguments: '' };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.type) toolCalls[idx].type = tc.type;
          if (tc.function?.name) toolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
        }
      }
    }
  } catch (err) {
    if (err.message === 'Request aborted') {
      console.log(chalk.dim('\n(anulat)'));
      if (thinkContent.trim()) saveThinkingLog(thinkContent);
      return { content, toolCalls: [], aborted: true };
    }
    throw err;
  }

  if (content) console.log();

  // Salvează thinking în log dacă există
  if (thinkContent.trim()) {
    saveThinkingLog(thinkContent);
    const date = new Date().toISOString().slice(0, 10);
    console.log(chalk.dim(`(gândire salvată → ~/.utmai/thinking_logs/${date}.log)`));
  }

  const toolCallsList = Object.values(toolCalls).filter(tc => tc.id && tc.name);
  return { content, toolCalls: toolCallsList, aborted: false };
}

// --- Handle tool calls ---
async function handleToolCalls(content, toolCallsList) {
  // Adaugă mesajul asistentului cu tool_calls în istoric
  const assistantMsg = { role: 'assistant' };
  if (content) assistantMsg.content = content;
  assistantMsg.tool_calls = toolCallsList.map(tc => ({
    id: tc.id,
    type: 'function',
    function: {
      name: tc.name,
      arguments: tc.arguments,
    },
  }));
  conversationHistory.push(assistantMsg);

  // Execută fiecare tool call
  for (const tc of toolCallsList) {
    let args;
    try {
      args = JSON.parse(tc.arguments);
    } catch {
      const errorMsg = 'Eroare: argumente JSON invalide';
      renderer.toolError(errorMsg);
      conversationHistory.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: errorMsg,
      });
      continue;
    }

    // Afișează tool call
    renderer.toolCall(tc.name, formatToolArgs(tc.name, args));

    let result;
    if (needsConfirmation(tc.name)) {
      const approved = await askConfirmation(renderer.confirmPrompt());
      if (!approved) {
        renderer.toolDenied();
        conversationHistory.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: 'Utilizatorul a refuzat execuția',
        });
        continue;
      }
    }

    try {
      result = await executeTool(tc.name, args);
      renderer.toolResult(result);
    } catch (err) {
      result = `Eroare: ${err.message}`;
      renderer.toolError(err.message);
    }

    const MAX_RESULT = 6000;
    const resultStr = String(result);
    const truncated = resultStr.length > MAX_RESULT
      ? resultStr.slice(0, MAX_RESULT) + `\n... (trunchiat, ${resultStr.length - MAX_RESULT} caractere omise)`
      : resultStr;

    conversationHistory.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: truncated,
    });
  }
}

function formatToolArgs(name, args) {
  switch (name) {
    case 'bash':
      return args.command || JSON.stringify(args);
    case 'read_file':
      return args.path || JSON.stringify(args);
    case 'glob':
      return args.pattern + (args.path ? ` (în ${args.path})` : '');
    case 'write_file':
      return `${args.path} (${args.content?.length || 0} caractere)`;
    case 'edit_file':
      return args.path;
    default:
      return JSON.stringify(args);
  }
}

// --- Autentificare ---
// Implicit: login în browser, ca la orice unealtă modernă — nu se mai lipește nicio cheie de mână.
// Lipirea rămâne ca a doua opțiune, pentru CI și mașini fără browser.
async function authenticate({ force = false } = {}) {
  if (!force) {
    const { apiKey } = config.loadCredentials();
    if (apiKey) return true;
  }
  return runLogin();
}

/** `--name "Laptop birou"` / `--name=…` — numele sub care apare cheia în contul tău. */
function nameFlag() {
  const a = process.argv.slice(2);
  const i = a.indexOf('--name');
  if (i >= 0 && a[i + 1] && !a[i + 1].startsWith('-')) return a[i + 1];
  const inline = a.find(x => x.startsWith('--name='));
  return inline ? inline.slice('--name='.length) : undefined;
}

async function runLogin() {
  const browserAvailable = auth.hasBrowser();
  renderer.loginMenu(browserAvailable);
  const answer = (await ask(renderer.choicePrompt())).trim();
  const method = answer === '2' ? 'key' : 'browser';

  if (method === 'key') {
    const key = await askPassword(chalk.bold('  Cheie API (utmai_…): '));
    if (!key.trim()) { renderer.error('Nicio cheie introdusă.'); return false; }
    try {
      const creds = await auth.loginWithApiKey(key.trim());
      renderer.loggedIn(creds);
      return true;
    } catch (err) {
      renderer.error(err.message);
      return false;
    }
  }

  try {
    const creds = await auth.loginWithBrowser({
      deviceName: nameFlag(),
      onEvent: (e) => {
        if (e.type === 'prompt') renderer.loginPrompt(e.userCode, e.url, e.opened);
      },
    });
    renderer.loggedIn(creds);
    return true;
  } catch (err) {
    renderer.error(err.message);
    return false;
  }
}

async function showStatus() {
  const { apiUrl } = config.loadSettings();
  let info = null;
  try {
    info = await auth.whoami();
  } catch (err) {
    renderer.error(err.message);
    return;
  }
  renderer.status(apiUrl, info, config.CREDENTIALS_FILE);
}

// --- Chat loop ---
async function sendAndProcess() {
  currentAbortController = new AbortController();

  try {
    const { content, toolCalls, aborted } = await processStream(currentAbortController.signal);

    if (aborted) return;

    if (toolCalls.length > 0) {
      await handleToolCalls(content, toolCalls);
      // Continuă loop-ul — trimite din nou la API
      return sendAndProcess();
    }

    // Doar conținut text — adaugă în istoric
    if (content) {
      conversationHistory.push({ role: 'assistant', content });
    }
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED') {
      renderer.error('Sesiune invalidă sau expirată. Autentifică-te din nou.');
      client.logout();
      const ok = await authenticate({ force: true });
      if (ok) return sendAndProcess();
      return;
    }
    renderer.error(err.message);
  } finally {
    currentAbortController = null;
  }
}

// --- Comenzi speciale ---
async function runUpdate() {
  const { execSync } = require('child_process');
  const installDir = path.resolve(__dirname, '..');
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: installDir, stdio: 'pipe' }).toString().trim();
  const gitOr = (cmd, fallback) => { try { return git(cmd); } catch { return fallback; } };

  // 🔴 Versiunea veche făcea `git remote set-url origin https://github.com/md5icos/utmai-public.git`
  // și trăgea de acolo. Rulată dintr-o copie a monorepo-ului, îți repointa remote-ul repo-ului tău
  // spre un mirror public și trăgea peste el. Acum actualizăm DIN locul de unde a fost instalat
  // CLI-ul, pe remote-ul și ramura lui curentă, fără să atingem configurația git.
  renderer.info('Actualizare UTM AI Code...');
  try {
    try {
      git('rev-parse --is-inside-work-tree');
    } catch {
      renderer.error(`${installDir} nu este un repo git — actualizează-l cum l-ai instalat.`);
      return;
    }
    if (gitOr('status --porcelain', '')) {
      renderer.error('Ai modificări necomise în directorul de instalare. Comite-le sau pune-le deoparte întâi.');
      return;
    }
    const branch = gitOr('rev-parse --abbrev-ref HEAD', 'HEAD');
    if (branch === 'HEAD') {
      renderer.error('Ești pe un commit detașat. Treci pe o ramură înainte de actualizare.');
      return;
    }
    const remote = gitOr(`config --get branch.${branch}.remote`, 'origin');
    renderer.info(`git pull --ff-only ${remote} ${branch}`);
    execSync(`git pull --ff-only ${remote} ${branch}`, { cwd: installDir, stdio: 'inherit' });
    execSync('npm install', { cwd: installDir, stdio: 'inherit' });
    renderer.info('Actualizare completă. Repornește CLI-ul pentru modificări.');
  } catch (err) {
    renderer.error(`Actualizare eșuată: ${err.message}`);
  }
}

async function handleCommand(input) {
  const cmd = input.trim().toLowerCase();
  switch (cmd) {
    case '/login':
      await authenticate({ force: true });
      return true;
    case '/status':
      await showStatus();
      return true;
    case '/new':
    case '/nou':
      conversationHistory = [SYSTEM_MESSAGE];
      renderer.info('Conversație nouă');
      return true;
    case '/exit':
    case '/quit':
      console.log(chalk.dim('\nLa revedere!'));
      process.exit(0);
    case '/help':
      renderer.help();
      return true;
    case '/update':
      runUpdate();
      return true;
    case '/logout':
      client.logout();
      renderer.info('Credențiale șterse. La revedere!');
      process.exit(0);
    default:
      return false;
  }
}

// --- Help flag ---
function checkFlags() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${chalk.bold.cyan('UTM AI Code')} — Asistent de programare CLI

${chalk.bold('Utilizare:')}
  utmai                Pornește interfața interactivă
  utmai login          Autentificare (login în browser sau cheie API)
  utmai login --name N Autentificare, numind cheia N (implicit: numele mașinii)
  utmai logout         Șterge credențialele locale
  utmai status         Cine ești, cu ce cheie și până când

${chalk.bold('Comenzi interactive:')}
  /new, /nou           Conversație nouă
  /login               Autentificare din nou (schimbă contul)
  /status              Starea sesiunii
  /exit, /quit         Ieșire
  /help                Afișează comenzile disponibile
  /update              Actualizează CLI-ul (git pull --ff-only în directorul de instalare)
  /logout              Delogare și ieșire

${chalk.bold('Variabile de mediu:')}
  UTMAI_API_URL        URL-ul API-ului (default: https://utmai-api.cybercor.org)
  UTMAI_CLI_KEY        Cheia API, dacă nu vrei să fie salvată pe disc

${chalk.bold('Configurare:')}
  ~/.utmai/config.json       URL-ul API-ului
  ~/.utmai/credentials.json  Cheia de acces (drepturi 0600)
`);
    process.exit(0);
  }
}

// Subcomenzi de shell: `utmai login` / `logout` / `status`. Rulează și ies, fără să pornească REPL-ul.
async function runSubcommand() {
  const cmd = process.argv.slice(2).find(a => !a.startsWith('-'));
  if (!cmd) return false;

  if (cmd === 'login') {
    const ok = await runLogin();
    rl.close();
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'logout') {
    client.logout();
    renderer.info('Credențiale șterse.');
    rl.close();
    process.exit(0);
  }
  if (cmd === 'status') {
    await showStatus();
    rl.close();
    process.exit(0);
  }
  renderer.error(`Comandă necunoscută: ${cmd}. Vezi „utmai --help".`);
  rl.close();
  process.exit(1);
}

// --- Main ---
async function main() {
  checkFlags();

  // Instalări de dinainte de login-ul din browser: cheia stătea în config.json, cu drepturile
  // implicite ale umask-ului. O mutăm în fișierul de credențiale (0600) și spunem o dată ce s-a
  // întâmplat — altfel utilizatorul ar crede că a fost delogat.
  if (config.migrateLegacyKey()) {
    renderer.info(`Cheia a fost mutată în ${config.CREDENTIALS_FILE} (drepturi 0600).`);
  }

  await runSubcommand();

  renderer.welcome();

  const ok = await authenticate();
  if (!ok) {
    rl.close();
    process.exit(1);
  }

  // Loop principal
  const promptForInput = () => {
    rl.question(renderer.userPrompt(), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        promptForInput();
        return;
      }

      if (trimmed.startsWith('/')) {
        const handled = await handleCommand(trimmed);
        if (handled) {
          promptForInput();
          return;
        }
      }

      // Adaugă mesajul utilizatorului în istoric
      conversationHistory.push({ role: 'user', content: trimmed });

      await sendAndProcess();

      promptForInput();
    });
  };

  promptForInput();
}

// Ctrl+C handling
process.on('SIGINT', () => {
  process.stdout.write('\r\x1b[2K'); // șterge linia curentă (thinking indicator)
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    return;
  }
  console.log(chalk.dim('\nLa revedere!'));
  rl.close();
  process.exit(0);
});

// Erori neașteptate
process.on('uncaughtException', (err) => {
  renderer.error(`Eroare neașteptată: ${err.message}`);
});

main().catch((err) => {
  renderer.error(err.message);
  process.exit(1);
});
