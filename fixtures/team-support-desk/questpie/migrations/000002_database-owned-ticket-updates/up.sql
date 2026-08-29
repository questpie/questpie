-- questpie-step: 9e80d576be7a006b465c6e7e9c7428b0fc851e9b20c71d98825b8b83a8ad4c41
CREATE FUNCTION "team_support_desk"."qp_on_update_tickets_updated_at_127b75712913"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $questpie$
BEGIN
  NEW."updated_at" := pg_catalog.transaction_timestamp();
  RETURN NEW;
END
$questpie$;
REVOKE ALL ON FUNCTION "team_support_desk"."qp_on_update_tickets_updated_at_127b75712913"() FROM PUBLIC;
CREATE TRIGGER "tickets_updated_at_questpie_on_update_d9d884bc0536"
BEFORE UPDATE ON "team_support_desk"."tickets"
FOR EACH ROW EXECUTE FUNCTION "team_support_desk"."qp_on_update_tickets_updated_at_127b75712913"();
