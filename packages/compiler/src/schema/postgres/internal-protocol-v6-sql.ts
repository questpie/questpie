export const internalProtocolV6Sql = `
ALTER TABLE questpie_internal.durable_run_events
  DROP CONSTRAINT durable_event_kind_known;

ALTER TABLE questpie_internal.durable_run_events
  ADD CONSTRAINT durable_event_kind_known CHECK (
    kind IN ('accepted', 'ambiguityAcknowledged', 'attemptStarted', 'cancellationRequested',
             'cancelled', 'effectAmbiguous', 'effectSettled', 'failed', 'leaseSuperseded',
             'retryRequested', 'retryScheduled', 'succeeded')
  );
`;
