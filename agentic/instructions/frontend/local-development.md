# Local Development (macOS Apache)

## Confirmed Local Path and URL

- Monorepo: `/Users/daniel/Development/altcontext-marketing-monorepo/`
- Frontend URL: `http://dev.test/altcontext-marketing-monorepo/`

## `.htaccess` Rewrite for Serving `frontend/dist/`

File: `/Users/daniel/Development/altcontext-marketing-monorepo/.htaccess`

```apacheconf
RewriteEngine On

RewriteRule ^frontend/dist/ - [L]

RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

RewriteRule ^$ frontend/dist/ [L]
RewriteRule ^(.+)$ frontend/dist/$1 [L]
```

## Git Hygiene

- `.htaccess` should be gitignored as local-only convenience.
- Keep a committed template at `./.htaccess.example`.
