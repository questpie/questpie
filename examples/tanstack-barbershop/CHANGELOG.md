# Changelog

## Unreleased

### Patch

- Fix admin live preview for barber detail pages by using stable slug URLs, wiring `useCollectionPreview` in the barber route, and enabling `PreviewField` click-to-focus mappings for key fields.
- Make barber detail loader draft-aware so preview mode can load unpublished or inactive barber records when `__draft_mode` is enabled.
