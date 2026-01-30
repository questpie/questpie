---
"@questpie/admin": patch
"questpie": patch
---

feat: add Prettify to admin builder types and improve DX

- Add `Prettify` wrapper to merged types in AdminBuilder for better IDE tooltips
- Add default `ConsoleAdapter` for email in development mode (no config needed)
- Fix package.json dependencies: move runtime deps (pino, drizzle-orm, zod) to dependencies, keep optional adapters (pg, ioredis, nodemailer, pg-boss) as optional peer deps
