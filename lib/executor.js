const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const { glob } = require('glob');

async function executeTool(name, args) {
  switch (name) {
    case 'read_file':
      return readFile(args);
    case 'write_file':
      return writeFile(args);
    case 'edit_file':
      return editFile(args);
    case 'bash':
      return bashExec(args);
    case 'glob':
      return globSearch(args);
    case 'list_dir':
      return listDir(args);
    case 'grep':
      return grepSearch(args);
    default:
      return `Tool necunoscut: ${name}`;
  }
}

function readFile({ path: filePath }) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Fișierul nu există: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Calea este un director, nu un fișier: ${resolved}`);
  }
  // Limită de 1MB
  if (stat.size > 1024 * 1024) {
    throw new Error(`Fișierul este prea mare (${(stat.size / 1024 / 1024).toFixed(1)}MB). Limita: 1MB`);
  }
  return fs.readFileSync(resolved, 'utf-8');
}

function writeFile({ path: filePath, content }) {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolved, content, 'utf-8');
  return `Fișier scris: ${resolved} (${Buffer.byteLength(content)} bytes)`;
}

function editFile({ path: filePath, old_text, new_text }) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Fișierul nu există: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  const count = content.split(old_text).length - 1;

  if (count === 0) {
    throw new Error('Textul de căutat nu a fost găsit în fișier');
  }

  const newContent = content.replace(old_text, new_text);
  fs.writeFileSync(resolved, newContent, 'utf-8');
  return `Fișier editat: ${resolved} (${count} ${count === 1 ? 'înlocuire' : 'înlocuiri'})`;
}

function normalizeCommand(command) {
  if (process.platform === 'win32') {
    return command.replace(/\bpython3\b/g, 'python').replace(/\bpip3\b/g, 'pip');
  }
  return command;
}

function bashExec({ command, timeout = 30000, background = false }) {
  const cmd = normalizeCommand(command);
  if (background) {
    return bashBackground(cmd);
  }
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: Math.min(timeout, 300000),
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    return output || '(fără output)';
  } catch (err) {
    if (err.code === 'ETIMEDOUT') {
      throw new Error(`Timeout după ${timeout / 1000}s. Folosește background:true pentru procese long-running.`);
    }
    const stderr = err.stderr ? err.stderr.trim() : '';
    const stdout = err.stdout ? err.stdout.trim() : '';
    const msg = stderr || stdout || err.message;
    throw new Error(`Comandă eșuată (exit ${err.status || '?'}): ${msg}`);
  }
}

function bashBackground(command) {
  const logDir = path.join(os.homedir(), '.utmai', 'proc_logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `proc_${Date.now()}.log`);

  // Pe Windows: pythonw.exe nu deschide fereastră de consolă
  const cmd = process.platform === 'win32'
    ? command.replace(/\bpython\b/g, 'pythonw')
    : command;

  const out = fs.openSync(logFile, 'w');
  const proc = spawn(cmd, [], {
    shell: true,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  proc.unref();
  return `Proces pornit în background (PID: ${proc.pid}).\nOutput: ${logFile}\nOprire: taskkill /PID ${proc.pid} /F`;
}

function listDir({ path: dirPath, show_hidden = false }) {
  const resolved = dirPath ? path.resolve(dirPath) : process.cwd();
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directorul nu există: ${resolved}`);
  }
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const filtered = show_hidden ? entries : entries.filter(e => !e.name.startsWith('.'));
  filtered.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const lines = filtered.map(e => {
    const type = e.isDirectory() ? '/' : e.isSymbolicLink() ? '@' : '';
    const size = e.isFile() ? ` (${fs.statSync(path.join(resolved, e.name)).size} B)` : '';
    return `${e.name}${type}${size}`;
  });
  return `${resolved}:\n${lines.join('\n') || '(gol)'}`;
}

function grepSearch({ pattern, path: searchPath, recursive = true, case_sensitive = false }) {
  const target = searchPath ? path.resolve(searchPath) : process.cwd();
  const flags = case_sensitive ? '' : 'i';
  let regex;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }

  const MAX_FILES = 20;
  const MAX_MATCHES_PER_FILE = 5;
  const MAX_FILE_SIZE = 512 * 1024; // 512KB

  function walkDir(dir, results, fileCount) {
    if (fileCount[0] >= MAX_FILES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (fileCount[0] >= MAX_FILES) break;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) walkDir(full, results, fileCount);
      } else if (entry.isFile()) {
        const matches = searchInFile(full, regex, MAX_MATCHES_PER_FILE, MAX_FILE_SIZE);
        if (matches.length > 0) {
          results.push(`--- ${full} ---\n${matches.join('\n')}`);
          fileCount[0]++;
        }
      }
    }
  }

  function searchInFile(filePath, re, maxMatches, maxSize) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > maxSize) return [];
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const matches = [];
      for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
        if (re.test(lines[i])) {
          matches.push(`${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        }
      }
      return matches;
    } catch { return []; }
  }

  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (!stat) throw new Error(`Calea nu există: ${target}`);

  const results = [];
  const fileCount = [0];

  if (stat.isFile()) {
    const matches = searchInFile(target, regex, MAX_MATCHES_PER_FILE, MAX_FILE_SIZE);
    if (matches.length > 0) results.push(`--- ${target} ---\n${matches.join('\n')}`);
  } else {
    walkDir(target, results, fileCount);
  }

  return results.length > 0 ? results.join('\n\n') : 'Niciun rezultat găsit';
}

async function globSearch({ pattern, path: searchPath }) {
  const cwd = searchPath ? path.resolve(searchPath) : process.cwd();
  const files = await glob(pattern, { cwd, nodir: false });
  if (files.length === 0) {
    return 'Niciun fișier găsit';
  }
  // Limităm la 500 de rezultate
  const limited = files.slice(0, 500);
  let result = limited.join('\n');
  if (files.length > 500) {
    result += `\n... (${files.length - 500} rezultate omise)`;
  }
  return result;
}

module.exports = { executeTool };
