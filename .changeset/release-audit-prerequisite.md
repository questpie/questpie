---
"questpie": minor
"create-questpie": patch
---

Require the security-fixed Nodemailer 10.0.9 API for the optional SMTP adapter. Generated project templates request the corrected Nodemailer and pg-boss peers.

When running SMTP on Node.js, upgrade to Node.js 20+ and Nodemailer 10.0.9+. Nodemailer 9.x no longer satisfies the optional peer. The core Node.js 18+ requirement is unchanged for applications that do not use SMTP. Nodemailer now includes its own TypeScript declarations, so the framework no longer installs the separate `@types/nodemailer` development dependency.
