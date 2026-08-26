-- questpie-step: 3f13f93b60074d58c1a1967856ee6c9f9a159b53e9b61f65985a7b7be61c1335
CREATE SCHEMA "team_support_desk";

-- questpie-step: 71d618f1a70c061525198df13e3defdc716969597e4f6b8b2b086a3c774853b5
CREATE TABLE "team_support_desk"."comments" (
  "author_membership_id" pg_catalog.uuid NOT NULL,
  "body" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "created_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "kind" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'public',
  "ticket_id" pg_catalog.uuid NOT NULL
);

-- questpie-step: 646af907f6953711826027c93f943859c60f7ed138bced212e66ace4b951f048
CREATE TABLE "team_support_desk"."labels" (
  "color" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "created_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "name" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "organization_id" pg_catalog.uuid NOT NULL,
  "ticket_id" pg_catalog.uuid NOT NULL
);

-- questpie-step: 8fb47495e2b57ba383630c72caf99a69ffd47844eb98c19c8d1dbef3f2851a77
CREATE TABLE "team_support_desk"."memberships" (
  "created_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "organization_id" pg_catalog.uuid NOT NULL,
  "principal_id" pg_catalog.uuid NOT NULL,
  "role" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'customer',
  "status" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'active',
  "updated_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now()
);

-- questpie-step: 880ff5beb90b182d1fea6996d48ed733b53fb9bf4e140c6e969ded3088703029
CREATE TABLE "team_support_desk"."organizations" (
  "created_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "name" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "updated_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now()
);

-- questpie-step: feb235637aa39731edc9f0f94c232f12310b9df3a99b60e9968a203999f2a18c
CREATE TABLE "team_support_desk"."teams" (
  "created_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "name" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "organization_id" pg_catalog.uuid NOT NULL,
  "routing_status" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'active',
  "updated_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now()
);

-- questpie-step: aae8e3e6a0ca54315a9c4b4c66149355cdf235df833c76f606e2ef35c4c6bc15
CREATE TABLE "team_support_desk"."tickets" (
  "assignee_membership_id" pg_catalog.uuid,
  "closed_at" pg_catalog.timestamptz,
  "created_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  "description" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "last_sla_follow_up_at" pg_catalog.timestamptz,
  "organization_id" pg_catalog.uuid NOT NULL,
  "priority" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'normal',
  "reference" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "requester_membership_id" pg_catalog.uuid NOT NULL,
  "status" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'open',
  "summary" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "team_id" pg_catalog.uuid NOT NULL,
  "updated_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now()
);

-- questpie-step: 62e760619eea3e18eba80361de0521268108374e0bfcb0a62ded4d9aaaf31b79
ALTER TABLE "team_support_desk"."comments" ADD CONSTRAINT "qp_pk_comments_primary" PRIMARY KEY ("id");

-- questpie-step: bb63eabea964adf6baae871689e5a9a0fb84289a4705deddc679935e1e528e2d
ALTER TABLE "team_support_desk"."comments" ADD CONSTRAINT "qp_ck_comments_body_max_length" CHECK ((pg_catalog.char_length("body") <= 8192));

-- questpie-step: 9b6f6d79d489cc0cd9af0163c6e62216a0fce74941216d6f405d945930e46cb2
ALTER TABLE "team_support_desk"."comments" ADD CONSTRAINT "qp_ck_comments_body_min_length" CHECK ((pg_catalog.char_length("body") >= 1));

-- questpie-step: c31f388259630dd7007a87ca1b75621d740ee30f5562765b9668349abad6586a
ALTER TABLE "team_support_desk"."comments" ADD CONSTRAINT "qp_ck_comments_kind_max_length" CHECK ((pg_catalog.char_length("kind") <= 16));

-- questpie-step: ca0da41dd0ea17a3053430b98a290cbd3676deb981959e1b500d98b86613e9d4
ALTER TABLE "team_support_desk"."comments" ADD CONSTRAINT "qp_ck_comments_kind_min_length" CHECK ((pg_catalog.char_length("kind") >= 1));

-- questpie-step: 705909ead2951a777bf299f4bde14c547e7fbb61aa074b9bd7e26ac10539ef9d
ALTER TABLE "team_support_desk"."labels" ADD CONSTRAINT "qp_pk_labels_primary" PRIMARY KEY ("id");

-- questpie-step: a31099eafb2b9c82d3d515085faa5cde44ee5c40eea89a20fef0ff86ae837138
ALTER TABLE "team_support_desk"."labels" ADD CONSTRAINT "qp_uq_labels_ticket_name" UNIQUE ("ticket_id", "name");

-- questpie-step: 72599d2bfb8d490caf60b017a2b1725f465b153bc54c5a53cc075a65a0d123ce
ALTER TABLE "team_support_desk"."labels" ADD CONSTRAINT "qp_ck_labels_color_max_length" CHECK ((pg_catalog.char_length("color") <= 16));

-- questpie-step: ab77b6ba255041c59df76ca2ae3a9bc127e57fb4de60d76115234ca721ef0f17
ALTER TABLE "team_support_desk"."labels" ADD CONSTRAINT "qp_ck_labels_color_min_length" CHECK ((pg_catalog.char_length("color") >= 4));

-- questpie-step: 82e00c7f4a15ffd3aa342c241d74324a8af5f18b50d5b59088b459b6f137d258
ALTER TABLE "team_support_desk"."labels" ADD CONSTRAINT "qp_ck_labels_name_max_length" CHECK ((pg_catalog.char_length("name") <= 48));

-- questpie-step: 927f185caf51e45166c139b858d2e975d71e98ad7cd666fa49f0cf0443d13c93
ALTER TABLE "team_support_desk"."labels" ADD CONSTRAINT "qp_ck_labels_name_min_length" CHECK ((pg_catalog.char_length("name") >= 1));

-- questpie-step: da6638cca2679875a7ee1f2f3491a30734e1ec0f6e18598a48db8164897d99d5
ALTER TABLE "team_support_desk"."memberships" ADD CONSTRAINT "qp_uq_memberships_organization_principal" UNIQUE ("organization_id", "principal_id");

-- questpie-step: 1d710084c86d783c8642236255462276b3e6c1ef9dfa4d9114cb2f2fbcba7909
ALTER TABLE "team_support_desk"."memberships" ADD CONSTRAINT "qp_pk_memberships_primary" PRIMARY KEY ("id");

-- questpie-step: b0537f95baced6528b301fa122b903bac2d3115e77d5218eca56ab70da221726
ALTER TABLE "team_support_desk"."memberships" ADD CONSTRAINT "qp_ck_memberships_role_max_length" CHECK ((pg_catalog.char_length("role") <= 16));

-- questpie-step: b266e07ac197bbd13575ea58e82a6cd684793c6c2f58e028fd38801e8b01ec2d
ALTER TABLE "team_support_desk"."memberships" ADD CONSTRAINT "qp_ck_memberships_role_min_length" CHECK ((pg_catalog.char_length("role") >= 1));

-- questpie-step: 4f2e4cdbb8ca164e94af9dd48b8a6702f7289cc5eaa16eb37bf3456256d46d22
ALTER TABLE "team_support_desk"."memberships" ADD CONSTRAINT "qp_ck_memberships_status_max_length" CHECK ((pg_catalog.char_length("status") <= 16));

-- questpie-step: 99a0f5c57531f5699474f0ecb183484b7bc69c2d1d60f4b5b3ddb83ebb1fcb9b
ALTER TABLE "team_support_desk"."memberships" ADD CONSTRAINT "qp_ck_memberships_status_min_length" CHECK ((pg_catalog.char_length("status") >= 1));

-- questpie-step: 21047fe3c90943735476a92b5d389adf17a58bf92257ba26d2e1884950d612bb
ALTER TABLE "team_support_desk"."organizations" ADD CONSTRAINT "qp_uq_organizations_name_unique" UNIQUE ("name");

-- questpie-step: 75d4ae3174b4c1ec5cd29cc8afe010145850bc21eff1414827dc3ff2921e2aa7
ALTER TABLE "team_support_desk"."organizations" ADD CONSTRAINT "qp_pk_organizations_primary" PRIMARY KEY ("id");

-- questpie-step: f7439b4e4342f6394c28dbdc6b1bd71093bf7d917d40f3298a308116ca5866a1
ALTER TABLE "team_support_desk"."organizations" ADD CONSTRAINT "qp_ck_organizations_name_max_length" CHECK ((pg_catalog.char_length("name") <= 120));

-- questpie-step: d893425b2327e913beda5f0b0add14da7214059aad13369e88aec5e0c0476ca7
ALTER TABLE "team_support_desk"."organizations" ADD CONSTRAINT "qp_ck_organizations_name_min_length" CHECK ((pg_catalog.char_length("name") >= 1));

-- questpie-step: 93e009b3ac033c6c0546350ede4aeca707b35a78bdb394d44981f90844cdbf5e
ALTER TABLE "team_support_desk"."teams" ADD CONSTRAINT "qp_pk_teams_primary" PRIMARY KEY ("id");

-- questpie-step: a5d7178efe326ee22e5a5a163e3cdc090c08fa6678e35005d4da3a5dd2917a42
ALTER TABLE "team_support_desk"."teams" ADD CONSTRAINT "qp_uq_teams_tenant_name" UNIQUE ("organization_id", "name");

-- questpie-step: 3ba4352ee04634720e63f02793626e631d82a1cb0bea96d072835ecdb37b9ca0
ALTER TABLE "team_support_desk"."teams" ADD CONSTRAINT "qp_ck_teams_name_max_length" CHECK ((pg_catalog.char_length("name") <= 120));

-- questpie-step: a6dcbb57fd0e62c06d8d8c4455e16b35c932bc3812fd788e073ca4cff97b8bb5
ALTER TABLE "team_support_desk"."teams" ADD CONSTRAINT "qp_ck_teams_name_min_length" CHECK ((pg_catalog.char_length("name") >= 1));

-- questpie-step: 6a2dea8604a6b14cc3b6790ed5a1c808143dc6b9b285e6bf46325732c77a1b7b
ALTER TABLE "team_support_desk"."teams" ADD CONSTRAINT "qp_ck_teams_routing_status_max_length" CHECK ((pg_catalog.char_length("routing_status") <= 16));

-- questpie-step: a79c3de16756fff829d1f5b73e0bf6895666ca348b77d12646c27a7a1b8e079e
ALTER TABLE "team_support_desk"."teams" ADD CONSTRAINT "qp_ck_teams_routing_status_min_length" CHECK ((pg_catalog.char_length("routing_status") >= 1));

-- questpie-step: ea92df4ae31410dd6fe9ab967d1bbe5d11061c7c146f8dd96383defced978f25
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_pk_tickets_primary" PRIMARY KEY ("id");

-- questpie-step: 1c7ba756b8a042b23012e5c5cfacd362960e77e6649d70d58af889e6ccfd9d70
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_uq_tickets_tenant_reference" UNIQUE ("organization_id", "reference");

-- questpie-step: 344c3ebaecebc9c463ebae548c38cd8c1bc7562961de0fa85eb0aa895e870b1d
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_description_max_length" CHECK ((pg_catalog.char_length("description") <= 16384));

-- questpie-step: a54c7bfd65f76a0939895cbbed67e985956d0da0f8655d88163e96be611e2fae
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_description_min_length" CHECK ((pg_catalog.char_length("description") >= 1));

-- questpie-step: a2c6fdbd385549b34e6ebfdeb8342586f48931e41b7b916973a11ad0e113e95f
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_priority_max_length" CHECK ((pg_catalog.char_length("priority") <= 16));

-- questpie-step: d369fa344bfd6f29f885ad03b9f659f9e28d339722f7be0992bc07dd02ad3c2f
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_priority_min_length" CHECK ((pg_catalog.char_length("priority") >= 1));

-- questpie-step: be06ee3213be85b298624dade4d2b9ad283f06ed37d3a1b08b63633806f1a00d
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_reference_max_length" CHECK ((pg_catalog.char_length("reference") <= 32));

-- questpie-step: 1a225c02252285654cba98e9ca03aeb1fd65df0f56ec11a8db0fef5e6d8fdbad
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_reference_min_length" CHECK ((pg_catalog.char_length("reference") >= 1));

-- questpie-step: bae959fef0b8f9bfadd3c39ed40b49b980dc0d7fec0bf58bfcaffe2d0a8860b1
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_status_max_length" CHECK ((pg_catalog.char_length("status") <= 16));

-- questpie-step: 94719bbb72529170651753c5509d1022749f3dc7618cfeb1e3e0b50e7a066f59
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_status_min_length" CHECK ((pg_catalog.char_length("status") >= 1));

-- questpie-step: f6c77a8de58c64e71a5eaf8b03746465e0b2cf466d06e12e710447132b57b7d6
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_summary_max_length" CHECK ((pg_catalog.char_length("summary") <= 240));

-- questpie-step: 3bd67dcf1bf84920d5f9a1918d4958935256fd0110ad78c8f4ba7239faef6bac
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_ck_tickets_summary_min_length" CHECK ((pg_catalog.char_length("summary") >= 1));

-- questpie-step: 4116542a2f365248c87280cd0439d2195447af499be4a57d868820d2aebd6598
ALTER TABLE "team_support_desk"."comments" ADD CONSTRAINT "qp_fk_comments_author" FOREIGN KEY ("author_membership_id") REFERENCES "team_support_desk"."memberships" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 8cd3b070baf69118bcf3ab63da63204202a37d893e0fe2ba69e168c9a0e20660
ALTER TABLE "team_support_desk"."comments" ADD CONSTRAINT "qp_fk_comments_ticket" FOREIGN KEY ("ticket_id") REFERENCES "team_support_desk"."tickets" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: cc7842575405fb1414ffeedc1d7caf4fdde9966f4d9b643fc4df107b72fce8ca
ALTER TABLE "team_support_desk"."labels" ADD CONSTRAINT "qp_fk_labels_organization" FOREIGN KEY ("organization_id") REFERENCES "team_support_desk"."organizations" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: a65831ced1f6101bcd5dbe54317698bca72902b0d9c5c2a3061ff29c4ce33789
ALTER TABLE "team_support_desk"."labels" ADD CONSTRAINT "qp_fk_labels_ticket" FOREIGN KEY ("ticket_id") REFERENCES "team_support_desk"."tickets" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 94612fa0ed5c279401d9d5b514e7a7f1727fbe52ee7e6ea7db75576554fc68cf
ALTER TABLE "team_support_desk"."memberships" ADD CONSTRAINT "qp_fk_memberships_organization" FOREIGN KEY ("organization_id") REFERENCES "team_support_desk"."organizations" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 1c6df1da34c0a635ce87867ce10562dd2cdd2e829cf304c719fde4adb8de9d37
ALTER TABLE "team_support_desk"."teams" ADD CONSTRAINT "qp_fk_teams_organization" FOREIGN KEY ("organization_id") REFERENCES "team_support_desk"."organizations" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: cd4802433a633511cc4c3eb6df8b614d4973a2f16ee4d291f09de84213094e12
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_fk_tickets_assignee" FOREIGN KEY ("assignee_membership_id") REFERENCES "team_support_desk"."memberships" ("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- questpie-step: 76e6a7ba86f67c660c1916636103a06a939e222b6479d3aa1704160b6e6d8557
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_fk_tickets_organization" FOREIGN KEY ("organization_id") REFERENCES "team_support_desk"."organizations" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: fe402282ec5672e13f1972118f0e3a1bed3c5094cbf5b6ba72886bb8964d193c
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_fk_tickets_requester" FOREIGN KEY ("requester_membership_id") REFERENCES "team_support_desk"."memberships" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: ca8b45e000c6061cfb625fc85467df8565cd1a743442b35c86592aa9975aa481
ALTER TABLE "team_support_desk"."tickets" ADD CONSTRAINT "qp_fk_tickets_team" FOREIGN KEY ("team_id") REFERENCES "team_support_desk"."teams" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: eed2ea4805dd69d5a5130bfbbc03080b285e7b4e5e61e681166265c6c5170276
CREATE INDEX "qp_ix_comments_page" ON "team_support_desk"."comments" USING btree ("ticket_id" ASC NULLS LAST, "created_at" DESC NULLS LAST, "id" DESC NULLS LAST);

-- questpie-step: 40efbb206bb42221ebb4f51624e214d87f7227e93c597acfab8de98e110e30ad
CREATE INDEX "qp_ix_labels_page" ON "team_support_desk"."labels" USING btree ("ticket_id" ASC NULLS LAST, "name" ASC NULLS LAST, "id" ASC NULLS LAST);

-- questpie-step: 2bec875c6a31559d53c155de5639e4a1c84fd0c459c78d806e00c7ffc6894b89
CREATE INDEX "qp_ix_memberships_principal" ON "team_support_desk"."memberships" USING btree ("principal_id" ASC NULLS LAST, "organization_id" ASC NULLS LAST);

-- questpie-step: 6b6248cae4e8f9128f7893469dcb7b42ea398f35c7245ff4fdab5a736ad19a1c
CREATE INDEX "qp_ix_memberships_tenant_role" ON "team_support_desk"."memberships" USING btree ("organization_id" ASC NULLS LAST, "status" ASC NULLS LAST, "role" ASC NULLS LAST, "id" ASC NULLS LAST);

-- questpie-step: 26bbdc914f91bd81c6cbcbf747832d2db6ce97a4a95d604abc50f21a5e6d1dc1
CREATE INDEX "qp_ix_organizations_page" ON "team_support_desk"."organizations" USING btree ("name" ASC NULLS LAST, "id" ASC NULLS LAST);

-- questpie-step: 7f75f53b457ee6218523dbef3f2f0f1a83d5803f4a9d5f61ce2a79030d33b5f8
CREATE INDEX "qp_ix_teams_routing_choices" ON "team_support_desk"."teams" USING btree ("organization_id" ASC NULLS LAST, "routing_status" ASC NULLS LAST, "name" ASC NULLS LAST, "id" ASC NULLS LAST);

-- questpie-step: 86af8005004545525c9fab2f74e550c739e4ce420d51367f29e92561402755ec
CREATE INDEX "qp_ix_tickets_queue" ON "team_support_desk"."tickets" USING btree ("organization_id" ASC NULLS LAST, "status" ASC NULLS LAST, "team_id" ASC NULLS LAST, "updated_at" DESC NULLS LAST, "id" DESC NULLS LAST);

-- questpie-step: 053a499057250c9b1f28db9e1cfb18a166f34f7a7950b12558d9eb34c1ea3b99
CREATE INDEX "qp_ix_tickets_requester_queue" ON "team_support_desk"."tickets" USING btree ("requester_membership_id" ASC NULLS LAST, "status" ASC NULLS LAST, "updated_at" DESC NULLS LAST, "id" DESC NULLS LAST);

-- questpie-step: 97f1f6d579f2942c564d6133ade88d28cf80466eeab361215ce9fca6ec00de5e
CREATE INDEX "qp_ix_tickets_tenant_status" ON "team_support_desk"."tickets" USING btree ("organization_id" ASC NULLS LAST, "status" ASC NULLS LAST, "updated_at" DESC NULLS LAST, "id" DESC NULLS LAST);

-- questpie-step: 66508e1dbb64fac050b9bb76e2d41d49055a08acc7fd6d85a6bb4e45c2103223
CREATE INDEX "qp_ix_tickets_tenant_team" ON "team_support_desk"."tickets" USING btree ("organization_id" ASC NULLS LAST, "team_id" ASC NULLS LAST, "updated_at" DESC NULLS LAST, "id" DESC NULLS LAST);

-- questpie-step: cb8ed44be6d9e3e34ce75b05bdc734f6a8ae0e893bb03618aee8f9d87cb02224
CREATE INDEX "qp_ix_tickets_tenant_updated" ON "team_support_desk"."tickets" USING btree ("organization_id" ASC NULLS LAST, "updated_at" DESC NULLS LAST, "id" DESC NULLS LAST);

-- questpie-step: 2b92b61c1c516e10dfca0e1cc1faa0a7f29eb404f485f4802be2480f057d49c6
CREATE TRIGGER comments_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.comments
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:comments', 'id');

CREATE TRIGGER comments_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.comments
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:comments');

CREATE TRIGGER labels_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.labels
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:labels', 'id');

CREATE TRIGGER labels_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.labels
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:labels');

CREATE TRIGGER memberships_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.memberships
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:memberships', 'id');

CREATE TRIGGER memberships_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.memberships
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:memberships');

CREATE TRIGGER teams_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.teams
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:teams', 'id');

CREATE TRIGGER teams_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.teams
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:teams');

CREATE TRIGGER tickets_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.tickets
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:tickets', 'id');

CREATE TRIGGER tickets_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.tickets
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:tickets');
