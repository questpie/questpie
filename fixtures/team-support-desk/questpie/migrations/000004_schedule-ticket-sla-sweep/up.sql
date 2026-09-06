-- questpie-step: 6d4e74a11250a35db76eaf69d10b234874a16298582e4c5eb5fd030f77ecc254
ALTER TABLE "team_support_desk"."tickets" ADD COLUMN "sla_follow_up_due_at" pg_catalog.timestamptz;

-- questpie-step: 2826df979e3a74f9d69f91b6de31768c17063edf15e9606050d0af8c9b5db3c0
CREATE INDEX "qp_ix_tickets_sla_due" ON "team_support_desk"."tickets" USING btree ("organization_id" ASC NULLS LAST, "status" ASC NULLS LAST, "sla_follow_up_due_at" ASC NULLS LAST, "id" ASC NULLS LAST);
