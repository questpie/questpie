---
"questpie": patch
---

Require `nodemailer` `^9.0.0` (resolved 9.0.1) to clear the high-severity raw-message file-access / SSRF advisory (GHSA-p6gq-j5cr-w38f). Only the optional SMTP mailer adapter consumes nodemailer, through its stable core API (`createTransport`/`sendMail`/`verify`), so the bump is transparent to apps.
