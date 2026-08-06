---
"questpie": minor
---

Remove the fleet-wide realtime capture mutex without allowing the outbox drain
to skip committed changes.

Capture is now one transactional log insert. Readers drain the settled prefix in
`(txid, seq)` order below PostgreSQL's snapshot frontier, so inverted sequence
and commit order no longer require every writer in every replica to update one
shared head row. In the checked-in PostgreSQL probe this changed 16-writer
throughput from 35 to 267 captures/s and p99 from 2404 ms to 222 ms.

Outbox retention now starts when a row is first observed below the settlement
frontier, not at transaction start. A long-running or prepared transaction can
therefore delay delivery, but cleanup cannot delete the committed rows it holds
back before any node is allowed to drain them. This adds the nullable
`questpie_realtime_log.settled_at` column and its cleanup index; generate and
apply a migration before deploying the new readers.

The settlement retry also covers the race where the blocking transaction ends
between an empty drain and its follow-up probe, so the newly readable change is
retried promptly instead of waiting for the reconciliation poll.

Expose `crdt.projection.prepareAcknowledgement` as the atomic consumer boundary
for a complete collaborative aggregate cut. The hook can validate and
canonicalize CRDT field values, write exact application relations through the
framework-owned transaction, and return ordinary owner projections such as a
content hash or plain-text form. A rejection rolls every callback write back
together with canonical fields, projection cursors and the realtime outbox.
