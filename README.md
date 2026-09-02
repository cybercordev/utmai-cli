# UTM AI Code

Asistent de programare în terminal, conectat la platforma **UTM AI** a Universității Tehnice a
Moldovei. Citește și scrie fișiere, rulează comenzi și caută prin proiect — sub controlul tău:
orice scriere cere confirmare.

Cere un cont pe platforma UTM AI.

## Instalare

Ai nevoie de **Node.js 18+**.

```bash
npm install -g git+https://github.com/cybercordev/utmai-cli.git
utmai login
```

Merge la fel pe Windows (PowerShell), macOS și Linux. Pe Windows, `npm` pune comanda `utmai` în
`%APPDATA%\npm`, deja în `PATH` la o instalare obișnuită de Node.

## Autentificare

La primul start, CLI-ul te întreabă cum vrei să intri:

```
  Autentificare UTM AI

  1. Login în browser  (cont UTM sau Microsoft)  ← recomandat
  2. Am o cheie API  (utmai_…, pentru CI/mecanisme)
```

**Login în browser** — se deschide singură pagina de aprobare, te autentifici cu contul tău și
confirmi codul afișat în terminal:

```
  Am deschis browserul pentru autentificare.

  Cod de confirmare:  KTQR-9WMD
  Adresă:             https://utmai.cybercor.org/cli/auth?code=KTQR-9WMD

  Aștept aprobarea…  (Ctrl+C pentru anulare)
```

După aprobare, CLI-ul își ia singur cheia de acces (valabilă 90 de zile) și o salvează local. O poți
revoca oricând din contul tău, secțiunea „Chei API & acces" — apare acolo ca `UTM AI CLI (mașina ta)`.

Pe o mașină fără browser (SSH, server), CLI-ul nu încearcă să deschidă nimic: îți arată adresa și
codul, le deschizi de pe alt calculator, iar terminalul primește cheia când aprobi.

Prin browser nu circulă niciun secret: pagina te trimite înapoi la o adresă locală care poartă doar
un `status`, iar cheia o poate ridica doar procesul care a pornit autentificarea (PKCE).

### Comenzi de sesiune

```bash
utmai login     # autentificare, sau schimbarea contului
utmai status    # cine ești, cu ce cheie și până când
utmai logout    # șterge credențialele locale
```

## Utilizare

```bash
utmai
```

| Comandă | Rol |
|---|---|
| `/new`, `/nou` | Conversație nouă |
| `/login` | Autentificare din nou |
| `/status` | Starea sesiunii |
| `/logout` | Delogare și ieșire |
| `/update` | Actualizează CLI-ul din locul de unde a fost instalat |
| `/help` | Comenzile disponibile |
| `/exit`, `/quit` | Ieșire |

## Ce poate face

Șapte unelte, în format OpenAI: `read_file`, `write_file`, `edit_file`, `bash`, `glob`, `list_dir`,
`grep`. Se execută **pe mașina ta**, nu pe server — serverul doar propune, tu decizi.

`write_file` și `edit_file` cer confirmare explicită înainte de fiecare scriere.

## Configurare

| Fișier | Conținut |
|---|---|
| `~/.utmai/config.json` | URL-ul API-ului |
| `~/.utmai/credentials.json` | cheia de acces (drepturi `0600` pe Linux/macOS) |
| `~/.utmai/thinking_logs/` | raționamentul modelului, pe zile |

Variabile de mediu, opționale:

```bash
export UTMAI_CLI_KEY=cheia_ta                        # bate fișierul de credențiale (util în CI)
export UTMAI_API_URL=https://utmai-api.cybercor.org  # implicit
```

> Pe Windows, `credentials.json` nu primește drepturi `0600` — `chmod` nu are efect acolo. Fișierul
> rămâne protejat de permisiunile profilului tău de utilizator.

## Licență

MIT — vezi [LICENSE](LICENSE).
