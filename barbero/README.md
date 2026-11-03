# Barbero — Jeddah

Website, customer + admin login portal, and a 10-chair hourly booking system for **Barbero** (Brazilian barbershop, Jeddah).
Bilingual (English / Arabic with full RTL). **Zero runtime dependencies** — just Node 22.13+ (built-in `http`, `crypto`, `node:sqlite`).

```bash
cd barbero
npm start                 # http://127.0.0.1:3000
npm test                  # 40 tests: security, booking rules, i18n
```

On the very first start an admin account is created and its **one-time generated password is printed in the console**
(`admin@barbero.local`). You are forced to replace it at first sign-in. To choose your own instead:

```bash
ADMIN_EMAIL=owner@barbero.sa ADMIN_PASSWORD='a long passphrase' npm start
# later: create / reset an admin
ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin
```

## What's in it

| URL | Who | What |
|---|---|---|
| `/` | everyone | Landing page: live "next open hour" chair board, services & prices, 7-day availability, hours, contact, gallery |
| `/login` | everyone | One login page with separate **Customer** and **Admin** tabs (+ customer sign-up) |
| `/account` | customers | Book (service → day → 1-hour slot → chair), my bookings (cancel), inbox/notifications, profile & password |
| `/admin` | admin only | Overview & day sheet, **schedule grid**, weekly **template + publish**, notify customers, customers, services & prices, activity log |

### Booking model
* **10 chairs**, every slot is **exactly one hour**. A slot is one row per `(date, hour, chair)`; status `free | booked | blocked`.
* **Template → publish:** the admin sets weekly open/close hours once. *Publish* turns a date range into free slots and (optionally) **notifies every customer** that new times are open. *Retract* removes unbooked slots.
* **Schedule grid:** hours × 10 chairs for any day. Click a cell to block/free it; click an hour or chair header to toggle the whole line; click a booked cell for the customer, notes, cancel / completed / no-show.
* Customers pick a specific chair or "any free chair" (lowest free). One chair per person per hour, max 3 upcoming bookings, free cancellation up to 2 h before (shop can always cancel; the customer is notified with the reason).
* Double-booking is impossible: unique `(date, hour, chair)` + a compare-and-set update inside an `IMMEDIATE` transaction (tested with 10 simultaneous requests for one chair).
* Times are Saudi time (UTC+3, no DST). Notifications are **in-app** (inbox + bell badge); there is no e-mail/SMS sender configured.

## Security design

| Threat | Defence | Verified by |
|---|---|---|
| Stolen database → passwords | **PBKDF2-HMAC-SHA-256**, 600,000 iterations, unique random 128-bit **salt per user**, plus a server-side **pepper** (HMAC-SHA-256, kept outside the DB). Constant-time compare. Hashes upgrade automatically if the work factor is raised. | `passwords:*` tests |
| Brute force / credential stuffing | Limits per IP, per (account+IP) and per account; lock-out after 5 failures; same response & same hashing time for unknown e-mails (no account oracle); common-password and identity checks | `brute force`, `passwords:*` |
| **SQL injection** | Every query is a static string with `?` placeholders (user input is only ever a bound parameter); allow-list validation in front; a test **fails the build** if SQL is ever built by interpolation/concatenation; `LIKE` wildcards escaped | `SQLi:*` tests |
| **XSS** | The UI never uses `innerHTML` (strings become text nodes); strict CSP — `default-src 'none'; script-src 'self'; style-src 'self'` (no inline anything) + `require-trusted-types-for 'script'`; names are letters-only; API is JSON-only with `nosniff`; scanner test bans inline script/handlers/`style=`/DOM sinks. Verified in a real browser: a `<script>` in a broadcast title renders as plain text, 0 CSP violations. | `XSS:*` tests + browser run |
| CSRF | `SameSite=Strict` cookie, Origin / Sec-Fetch-Site check on every state change, JSON-only bodies, per-session `X-CSRF-Token` | `CSRF:*` |
| Session theft / fixation | 256-bit random token; **only its SHA-256 is stored**; HttpOnly, SameSite=Strict, `Secure` + `__Host-` prefix in production; new token on login; all sessions revoked on password change; customer idle 24 h / admin idle **30 min** | `sessions:*` |
| Privilege escalation / IDOR | Role is never read from input (unknown fields are rejected); every admin route is checked server-side; admin pages **and scripts** aren't even served to non-admins; booking cancel is scoped `AND user_id = ?` | `authz:*`, `cancel` |
| Path traversal / info leak | Static files only from `public/`, allow-listed extensions, no dotfiles; DB, pepper and journals are `0600` in a `0700` dir; generic error bodies; no stack traces | `static:*`, `hygiene:*` |
| Clickjacking / DNS rebinding / headers | `frame-ancestors 'none'`, `X-Frame-Options`, Host allow-list, HSTS (prod), `Referrer-Policy`, `Permissions-Policy`, COOP/CORP | `XSS: every response…` |
| Abuse / DoS basics | 16 KB body cap, request/header timeouts, bounded rate-limiter memory, per-user booking & notify limits | `hygiene:*` |
| Accountability | Audit log of sign-ins, failures and every admin action (admin → *Activity log*) | `admin: …audit trail` |

> **On "SHA-256 with salt":** a single round of `SHA-256(salt + password)` can be guessed billions of times per second on a GPU.
> This project keeps the SHA-256 + per-user salt design you asked for but runs it through PBKDF2 (HMAC-SHA-256, 600k rounds) so each guess is expensive.

**Not included (recommended next):** admin two-factor auth, e-mail verification / password-reset e-mails (needs an e-mail provider), a shared rate-limit store if you run more than one server process, and a WAF/CDN in front.
Account sign-up reveals whether an e-mail is already registered (needed for a usable form; it is rate-limited).

## Photos
The shop photos could not be downloaded from the build environment (network policy), so the site ships with the brand logos only.
Drop real photos into `public/assets/photos/` — `hero.jpg` becomes the hero backdrop, everything else fills a gallery section that appears automatically. See `PUT-PHOTOS-HERE.txt`.
Brand colours come from the supplied logos: yellow `#FFE42B`, green `#05A84E`, black.

## Shop details to verify
`shop.json` (address, phone, Instagram) came from third-party listings and **has not been verified with Barbero**. The default weekly template (closed Sunday, 12:00–24:00, Friday from 14:00) and service list are placeholders; **no prices are set by default** — add them under *Admin → Services & prices*. Edit all of it in the admin portal.

## Deploying
```bash
NODE_ENV=production PUBLIC_ORIGIN=https://barbero.example.com TRUST_PROXY=true \
  DATA_DIR=/var/lib/barbero npm start
```
* Put it behind HTTPS (Caddy / nginx / Cloudflare). In production cookies are `Secure` and `PUBLIC_ORIGIN` is **required**.
* `TRUST_PROXY=true` only if exactly one reverse proxy you control sits in front (it reads the last `X-Forwarded-For` hop). `ALLOWED_HOSTS=a.com,b.com` adds extra host names.
* **Back up `DATA_DIR`** (the SQLite DB *and* `pepper.key` — without the pepper nobody can sign in). Optionally set `PASSWORD_PEPPER` instead of the key file.
* Uses SQLite in WAL mode: run a single instance.

## Layout
```
server/   config · db (schema) · security (hashing) · validate · http (CSP, static, router) · session · routes/{public,auth,customer,admin}
public/   index.html login.html account.html admin.html · css/ · js/ (dom, ui, i18n, api, forms, landing, login, account, admin + admin/*) · fonts/ (OFL) · assets/
test/     security.test.js booking.test.js i18n.test.js
scripts/  create-admin.js
```
Fonts (Bebas Neue, Inter, Cairo) are self-hosted under the SIL Open Font License (licenses in `public/fonts/`).
