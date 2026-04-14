# SSO setup (Google & Microsoft / “Outlook”)

Day Tracker uses **OAuth 2 authorization code** flows: the login page links to `api/auth.php?action=sso&provider=…`, which redirects to the provider; after consent, **`api/auth_callback.php`** exchanges the code, creates or links a user, and starts the PHP session.

## Prerequisites

- **HTTPS** in production (providers require secure `redirect_uri` origins).
- **`config.php`** on the server (from `config.example.php`) with client IDs/secrets **only on the server**—never in the Next.js bundle.
- **Redirect URIs** in Google/Microsoft consoles must match **`getBaseUrl()` + `/api/auth_callback.php`** exactly (scheme, host, path, no query).

## Configure `base_url` (subfolder or tricky hosting)

If the app is not at the domain root (e.g. `https://enabledtocreate.com/DayTracker/`), or auto-detection of the public URL is wrong, set in **`config.php`**:

```php
'base_url' => 'https://enabledtocreate.com/DayTracker',
```

(No trailing slash.) This value is used for:

- OAuth **`redirect_uri`** (must match the URI registered with Google/Microsoft byte-for-byte).
- Redirect back to the SPA after login.

If unset, the server derives the URL from **`HTTPS`**, **`X-Forwarded-Proto`**, **`HTTP_HOST`**, and the script path (see `lib/sso.php`).

## Google Cloud Console

1. Create a project (or use an existing one) → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** — add exactly one line per deployment, e.g.  
   `https://www.enabledtocreate.com/DayTracker/api/auth_callback.php`  
   (Use your real host, `www` or not, path, and HTTPS.)
4. Copy **Client ID** and **Client secret** into `config.php`:

```php
'google_client_id' => '….apps.googleusercontent.com',
'google_client_secret' => '…',
```

5. **OAuth consent screen**: add scopes **openid**, **email**, **profile** (already requested by the app). For a small user base, **Internal** or **External** + test users is typical.

## Microsoft identity platform (Outlook / Microsoft account)

1. **Azure Portal** → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. **Supported account types**: often “Accounts in any organizational directory and personal Microsoft accounts” for personal Outlook.com-style users (matches `/common` in code).
3. **Redirect URI**: **Web** → same pattern as Google, e.g.  
   `https://www.enabledtocreate.com/DayTracker/api/auth_callback.php`
4. Under **Certificates & secrets**, create a **Client secret**; copy **Application (client) ID** and secret into `config.php`:

```php
'outlook_client_id' => '…',
'outlook_client_secret' => '…',
```

5. **API permissions**: Microsoft Graph **Delegated** — **openid**, **email**, **profile**, **User.Read** (default openid flow covers sign-in; the app reads `/me` via Graph after token exchange).

## Verify

1. With secrets saved, open the app → **Log in** → **Google** or **Outlook**.
2. You should be redirected to the provider, then back to the app **logged in**.
3. If you see `?login_error=` in the URL, check server logs / `data/logs` if configured, and confirm **redirect URI** matches **including** `base_url` and **https**.

## Implementation reference

| Piece | Location |
|-------|----------|
| Redirect to provider | `api/auth.php` `action=sso` |
| OAuth `state` (provider id) | `lib/sso.php` — Google/Microsoft do not append `provider` to the callback |
| Token exchange + userinfo | `lib/sso.php` `ssoExchangeCode` |
| Session + user create/link | `api/auth_callback.php` |
| DB link table | `sso_accounts` in master SQLite |

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `redirect_uri_mismatch` | URI in console vs `base_url` + `/api/auth_callback.php` (path, HTTPS, trailing slash none on base). |
| `SSO not configured` | Empty `google_client_id` / `outlook_client_id` in `config.php`. |
| `login_error=invalid_callback` | Missing `code` or bad `state` — ensure latest `lib/sso.php` (OAuth `state`) is deployed. |
| `login_error=sso_failed` | Wrong secret, code reuse, or clock skew; check provider error in logs if logged. |

See also **`docs/HOSTING_APACHE.md`** for HTTPS redirects at the document root.
