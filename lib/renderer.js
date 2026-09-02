const chalk = require('chalk');
const { marked } = require('marked');
const { markedTerminal } = require('marked-terminal');

// Configurează marked pentru terminal
marked.use(markedTerminal({
  reflowText: true,
  width: Math.min(process.stdout.columns || 80, 120),
}));

function renderMarkdown(text) {
  if (!text) return '';
  return marked.parse(text).trimEnd();
}

function toolCall(name, args) {
  const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
  console.log(chalk.cyan(`\n┌ ${name}: `) + chalk.yellow(argsStr));
}

function confirmPrompt() {
  return chalk.bold('│ Execut? (da/nu): ');
}

function toolResult(result) {
  const lines = String(result).split('\n');
  const maxLines = 50;
  const display = lines.length > maxLines
    ? [...lines.slice(0, maxLines), `... (${lines.length - maxLines} linii omise)`]
    : lines;
  console.log(chalk.dim(display.map(l => `│ ${l}`).join('\n')));
  console.log(chalk.dim('└'));
}

function toolDenied() {
  console.log(chalk.yellow('│ Refuzat de utilizator'));
  console.log(chalk.dim('└'));
}

function toolError(err) {
  console.log(chalk.red(`│ Eroare: ${err}`));
  console.log(chalk.dim('└'));
}

function error(msg) {
  console.error(chalk.red(`\n✗ ${msg}`));
}

function info(msg) {
  console.log(chalk.blue(`\n${msg}`));
}

function welcome() {
  console.log(chalk.bold.cyan('\n  UTM AI Code — Asistent de programare\n'));
  console.log(chalk.dim('  Scrie /help pentru comenzi disponibile'));
  console.log(chalk.dim('  Ctrl+C pentru ieșire\n'));
}

function help() {
  console.log(chalk.bold('\nComenzi disponibile:'));
  console.log(chalk.cyan('  /new, /nou') + '   — Conversație nouă');
  console.log(chalk.cyan('  /login') + '       — Autentificare din nou (schimbă contul)');
  console.log(chalk.cyan('  /status') + '      — Starea sesiunii');
  console.log(chalk.cyan('  /logout') + '      — Delogare și ieșire');
  console.log(chalk.cyan('  /update') + '      — Actualizează CLI-ul');
  console.log(chalk.cyan('  /exit, /quit') + ' — Ieșire');
  console.log(chalk.cyan('  /help') + '        — Afișează acest mesaj\n');
}

// --- Autentificare ---

function loginMenu(browserAvailable) {
  console.log(chalk.bold('\n  Autentificare UTM AI\n'));
  const first = browserAvailable
    ? '  1. Login în browser' + chalk.dim('  (cont UTM sau Microsoft)')
    : '  1. Login în browser' + chalk.dim('  (fără browser aici — se afișează adresa)');
  console.log(first + chalk.green('  ← recomandat'));
  console.log('  2. Am o cheie API' + chalk.dim('  (utmai_…, pentru CI/mecanisme)') + '\n');
}

function choicePrompt() {
  return chalk.bold('  Alege [1/2]: ');
}

function loginPrompt(userCode, url, opened) {
  console.log(opened
    ? chalk.blue('\n  Am deschis browserul pentru autentificare.')
    : chalk.blue('\n  Deschide adresa de mai jos în browser (poate fi pe altă mașină):'));
  console.log('\n  ' + chalk.dim('Cod de confirmare:') + '  ' + chalk.bold.cyan(userCode));
  console.log('  ' + chalk.dim('Adresă:') + '             ' + chalk.underline(url));
  console.log(chalk.dim('\n  Verifică pe pagină același cod, apoi aprobă.'));
  console.log(chalk.dim('  Aștept aprobarea…  (Ctrl+C pentru anulare)'));
}

function loggedIn(creds) {
  const who = creds.username ? ` ca ${chalk.bold(creds.username)}` : '';
  console.log(chalk.green(`\n  ✓ Autentificat${who}.`));
  if (creds.expiresAt) {
    console.log(chalk.dim(`    Cheia „${creds.keyName || 'UTM AI CLI'}" e valabilă până la ${formatDate(creds.expiresAt)}.`));
  }
  console.log('');
}

function status(apiUrl, info, credentialsFile) {
  console.log(chalk.bold('\n  Stare sesiune\n'));
  console.log('  ' + chalk.dim('API:') + '        ' + apiUrl);
  if (!info) {
    console.log('  ' + chalk.dim('Cont:') + '       ' + chalk.yellow('neautentificat') + chalk.dim('  — rulează „utmai login"'));
    console.log('');
    return;
  }
  if (!info.ok) {
    const reason = info.status === 403 ? 'acces API restricționat' : 'cheie invalidă sau expirată';
    console.log('  ' + chalk.dim('Cont:') + '       ' + chalk.red(reason) + chalk.dim('  — rulează „utmai login"'));
    console.log('');
    return;
  }
  console.log('  ' + chalk.dim('Cont:') + '       ' + chalk.bold(info.username || '—') + (info.role ? chalk.dim(`  (${info.role})`) : ''));
  console.log('  ' + chalk.dim('Metodă:') + '     ' + (info.auth_method === 'apikey' ? 'cheie API' : info.auth_method));
  if (info.key_name) console.log('  ' + chalk.dim('Cheie:') + '      ' + info.key_name);
  if (info.expires_at) console.log('  ' + chalk.dim('Expiră:') + '     ' + formatDate(info.expires_at));
  console.log('  ' + chalk.dim('Sursă:') + '      ' + (info.source === 'env' ? 'UTMAI_CLI_KEY (mediu)' : credentialsFile));
  console.log('');
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ro-MD', { dateStyle: 'medium', timeStyle: 'short' });
}

function userPrompt() {
  return chalk.green.bold('Tu: ');
}

module.exports = {
  renderMarkdown,
  toolCall,
  confirmPrompt,
  toolResult,
  toolDenied,
  toolError,
  error,
  info,
  welcome,
  help,
  userPrompt,
  loginMenu,
  choicePrompt,
  loginPrompt,
  loggedIn,
  status,
};
