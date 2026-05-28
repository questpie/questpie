---
"questpie": patch
---

Preserve storage streams for upload and serve routes. Upload files can now be stream-only adapter inputs, storage writes keep explicit content length metadata, failed upload records clean up their written object, and collection file serving streams full and ranged responses without buffering the whole file.

Restore the public QueueJobType type export used by generated queue client typings.
