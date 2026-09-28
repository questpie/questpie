---
"questpie": patch
---

Collection and global writes (updates, soft deletes, restores, reverts, stage transitions) and `lockMany` now lock rows `FOR NO KEY UPDATE` instead of `FOR UPDATE`, so inserting a child row whose foreign key references a row being written no longer waits for that write to commit. Concurrent writers of the same row still serialize, and hard deletes and purges keep `FOR UPDATE`.
