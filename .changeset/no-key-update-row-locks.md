---
"questpie": minor
---

Collection and global updates that do not touch a key column (primary key or unique column) now lock the row `FOR NO KEY UPDATE` instead of `FOR UPDATE`, so inserting a child row that references it no longer waits for the update to commit; concurrent writers of the same row still wait for each other. `lockMany` also takes `FOR NO KEY UPDATE` and no longer keeps out foreign-key child inserts. Deletes, soft deletes included, are unchanged and still lock `FOR UPDATE`.
