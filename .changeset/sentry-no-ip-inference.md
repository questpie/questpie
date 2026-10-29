---
"@questpie/sentry": patch
---

Sentry no longer stores the sender's IP or a location derived from it. Events now carry `sdk.settings.infer_ip: "never"` and an empty `user.geo`. Before, Sentry stored the connecting IP as the user of every browser event (`user: ip:…`) and added a city-level `user.geo` to every event, although the event itself contains no IP. The project's "Prevent Storing of IP Addresses" setting alone does not remove that location.
