---
"questpie": minor
---

Add a PostgreSQL passage search adapter and trusted indexing API with live collection authorization before lexical/vector ranking, source-token compare-and-swap publication, profile isolation, and manifest-pinned exact reads.

Export bounded document extraction for PDF, DOCX, PPTX, XLSX and UTF-8 text, including source locators and explicit partial/unavailable results. The extractor requires Python and pypdf for PDF files. Correct self-relation aliases in ordinary collection queries as well as single-record authorization.

The adapter requires the `vector` extension to be provisioned before schema migrations. Semantic retrieval uses exact distance within the authorized partition; this release does not introduce approximate indexes or a universal capacity guarantee.
