// Definițiile tool-urilor în format OpenAI

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Citește conținutul unui fișier de pe disc',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Calea absolută sau relativă către fișier',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Scrie conținut într-un fișier (crează sau suprascrie)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Calea către fișier',
          },
          content: {
            type: 'string',
            description: 'Conținutul de scris în fișier',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Înlocuiește un text specific dintr-un fișier cu alt text',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Calea către fișier',
          },
          old_text: {
            type: 'string',
            description: 'Textul exact care trebuie înlocuit',
          },
          new_text: {
            type: 'string',
            description: 'Textul nou care va înlocui textul vechi',
          },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execută o comandă shell și returnează output-ul. Pentru procese care rulează la infinit (servere, scripturi de monitorizare) folosește background:true.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Comanda de executat',
          },
          timeout: {
            type: 'number',
            description: 'Timeout în milisecunde (default: 30000). Mărește pentru comenzi lungi.',
          },
          background: {
            type: 'boolean',
            description: 'Rulează în background fără a bloca (pentru servere sau scripturi infinite). Returnează PID-ul.',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Caută fișiere care se potrivesc cu un pattern glob',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Pattern-ul glob (ex: "**/*.js", "src/**/*.ts")',
          },
          path: {
            type: 'string',
            description: 'Directorul de bază pentru căutare (opțional, default: directorul curent)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Listează conținutul unui director (fișiere și subdirectoare)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Calea directorului (opțional, default: directorul curent)',
          },
          show_hidden: {
            type: 'boolean',
            description: 'Afișează fișierele ascunse (începând cu .)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Caută un pattern text în fișiere',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Textul sau expresia regulată de căutat',
          },
          path: {
            type: 'string',
            description: 'Fișierul sau directorul în care se caută',
          },
          recursive: {
            type: 'boolean',
            description: 'Caută recursiv în subdirectoare (default: true)',
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Căutare case-sensitive (default: false)',
          },
        },
        required: ['pattern'],
      },
    },
  },
];

// Tool-uri care necesită confirmare de la utilizator
const REQUIRES_CONFIRMATION = new Set(['write_file', 'edit_file']);

function needsConfirmation(toolName) {
  return REQUIRES_CONFIRMATION.has(toolName);
}

module.exports = { toolDefinitions, needsConfirmation };
