# Apache hosting (HTTP → HTTPS, subfolders)

Day Tracker’s static export + PHP can sit at the **domain root** or in a **subfolder** (e.g. `/DayTracker/`). Apache configuration is **outside** the app’s responsibility, but these patterns match typical IONOS / shared hosting.

## Force HTTPS (entire site)

Use `mod_rewrite` so every **insecure** request becomes **`https://`**, keeping the same **hostname** (`www`, `apex`, or a subdomain) and **path**:

- `http://www.example.com/DayTracker/` → `https://www.example.com/DayTracker/`
- `http://example.com/` → `https://example.com/`

The rules live in **`.htaccess`** at the **document root** for that site—the directory your host shows as the web root (`httpdocs`, `public_html`, etc.). That folder should be the **parent** of your app folder if the app is in a subfolder.

**Do not** rely only on `.htaccess` inside `/DayTracker/` if you also need `http://example.com/` (with no path) to redirect: Apache applies the root `.htaccess` first for `/`, and the subfolder file for URLs under `/DayTracker/`.

## Subdomains

`blog.example.com` and `www.example.com` usually have **separate** document roots. Add the **same** redirect block to **each** subdomain’s `.htaccess` in **its** root if you want HTTPS on all of them.

## Wildcard / apex

Redirect rules use `%{HTTP_HOST}`; they do not issue certificates. Your SSL must still cover each hostname (wildcard `*.domain.com` does **not** include bare `domain.com` unless the certificate lists it).

## Ship artifact

`npm run build` copies the repo **`.htaccess`** into **`release/.htaccess`**. That copy is meant for the **server**; merge or duplicate the **HTTPS block** into the **domain document root** as above if the app is deployed only under a subfolder.

## Redirect loop

If the browser loops on HTTPS, the host may set `X-Forwarded-Proto`. See comments in **`.htaccess`** for an alternative rule block, or ask IONOS support which header they use.
