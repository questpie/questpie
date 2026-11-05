---
"questpie": minor
---

Bulk updates and deletes now carry row images in the realtime outbox, up to `realtime.bulkRowImageLimit` rows (default `100`; `0` records none):

- Each row's scalar pre/post projection is written beside the batch's `count` and `recordIds` (`payload.rows`), so a bulk change routes like single-row changes do: a live query none of whose rows match skips it instead of refreshing. Conditional `updateMany` writes (`where` on id plus a version, cursor or status) become routable without giving up their compare-and-set.
- Over the limit, or when any row's image is missing, the change carries ids and count only and still routes as `unknown`, waking every candidate watcher of the collection as before.
- `afterChange` hooks of a bulk update receive the rows' pre-images as `originalRecords`, by the same ids as `records`.
