---
"@questpie/openapi": patch
---

OpenAPI schema component names now match the rest of the framework for
collection and global names containing spaces or repeated separators.

The generator carried its own private `toPascalCase` — twice, byte-identical in
`generator/collections.ts` and `generator/globals.ts` — using `/[-_](.)/g`. The
canonical implementation in `questpie/shared` uses `/[-_\s]+(.)?/g`, which also
collapses runs of separators and handles whitespace. A collection named
`blog posts` produced `Blog postsDocument` here and `BlogPosts` everywhere else;
`blog__posts` produced `Blog_postsDocument`.

Both copies are gone; the generators import the shared function. If you have a
collection or global whose name contains a space or a doubled `-`/`_`, its
generated schema component names change to the correct form — regenerate any
committed spec and any client generated from it. Names made of single separators
(`blog-posts`, `blog_posts`) are unaffected, which is the overwhelming majority.

The openapi bundle got slightly smaller rather than larger.
