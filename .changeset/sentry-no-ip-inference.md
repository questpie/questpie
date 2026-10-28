---
"@questpie/sentry": patch
---

Events now carry `sdk.settings.infer_ip: "never"`. Without it, Sentry stored the connecting IP as the user of every browser event (`user: ip:…`), although the event itself contains no IP. Sentry still derives a location (`user.geo`) from the connecting address; turn on the project's "Prevent Storing of IP Addresses" setting or use `tunnel` to keep a visitor's location out.
