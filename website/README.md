# Riot Bot website

The source of the project site at **https://bot.riotrequest.com**. It is a static page, dark-only and designed mobile-first, with no build step, no framework and no third-party requests. It is not part of the desktop app: the installer packs only `out/**`, and nothing here is bundled with Riot.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The whole page. The hero mascot is an inline SVG, so it stays sharp at any size. |
| `style.css` | All styles. They start at phone width, with breakpoints at 640px (tablet) and 960px (desktop). |
| `app.js` | The live mascot (eye tracking, blinking, moods, dozing when idle), scroll reveals, the site-access demo, the copy button and the GitHub switch. |
| `img/` | The six mood renders from the mascot concept sheet, as transparent WebP. |
| `fonts/` | Self-hosted Unbounded (headings) and Inter (body), Latin subset, with their licenses. |
| `og.png`, `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` | The social preview image and icons. |
| `.well-known/security.txt` | How to report a vulnerability ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)). Renew its `Expires` date before it passes, keeping it under a year ahead. |
| `deploy/htaccess-block.conf` | Server settings for Apache. Not served; see [Deploy](#deploy). |

## Preview locally

The page uses root-relative paths (`/style.css`, `/img/…`), so serve this folder as the web root:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory website
```

Then open http://127.0.0.1:8765/. Check it at phone width (375px) as well as desktop.

## The GitHub link

The repository is public at https://github.com/riotrequest/riot-bot. `index.html` links to it directly (nav, the Get it button, the clone command and the footer), and `app.js` holds the same address in `REPO_URL`. If the repository ever moves, update both.

## Editing

- **Keep scripts and styles in their files.** The server's Content-Security-Policy allows only same-origin `script-src` and `style-src`, so inline `<script>`, `<style>` and `style="…"` attributes in the HTML are blocked. Setting styles from JavaScript is fine.
- **Bump the version query** on `style.css?v=` and `app.js?v=` in `index.html` whenever either file changes. Browsers cache CSS and JS for a day; the HTML itself is always revalidated.
- **Keep claims accurate.** Feature copy should match the README and `docs/`. Riot is an early preview, Windows-only, built from source with no signed installer yet.
- **Respect reduced motion.** Animations switch off under `prefers-reduced-motion`; keep new ones inside that rule.

## Deploy

The site is plain files in the docroot of `bot.riotrequest.com` on the project's cPanel host. DNS is on Cloudflare (an `A` record for `bot`, DNS-only), and cPanel AutoSSL issues and renews the Let's Encrypt certificate.

From the repository root, replacing the placeholders:

```bash
cd website
tar -cf - index.html style.css app.js favicon.svg favicon-32.png apple-touch-icon.png og.png robots.txt .well-known/security.txt fonts img \
  | ssh <ssh-host> "cd <docroot> && tar -xf - --no-same-owner && chown -R <cpanel-user>:<cpanel-user> index.html style.css app.js favicon.svg favicon-32.png apple-touch-icon.png og.png robots.txt .well-known/security.txt fonts img"
```

First deploy only: append `deploy/htaccess-block.conf` to the docroot's `.htaccess`, after the block cPanel manages, and back up the original first. It adds the HTTPS redirect (leaving `/.well-known/` alone so AutoSSL can validate), security headers including the CSP, cache lifetimes, compression, and disables directory listings.

After deploying, check that every asset returns 200, that `http://` redirects to `https://`, and that the browser console shows no CSP errors.

If you switch the Cloudflare record to Proxied, set Cloudflare's SSL/TLS mode to **Full (strict)**. The origin already has a valid certificate.

## Credits and licenses

- Unbounded and Inter are licensed under the SIL Open Font License 1.1. See `fonts/OFL-Unbounded.txt` and `fonts/OFL-Inter.txt`.
- The mascot renders come from the Riot Bot mascot concept sheet (Charcoal `#3B3D42`, Teal Glow `#00E6B6`). The SVG mascot in `index.html` is drawn after it.

<!-- TODO(owner): decide whether the mascot artwork is covered by the repository's MIT License like the code, or kept as a reserved brand asset, and state it here. -->
> **TODO (owner):** decide whether the mascot artwork is covered by the MIT License like the rest of the repository, or reserved as a brand asset.
