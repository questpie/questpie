-- questpie-step: 3b600301d8fbd0dd7b40b2b52fb044a93d33b97d07c77659c32e8af42fe64f44
CREATE SCHEMA "archive";

-- questpie-step: dfb0bc2ea14883cc8e550a48d7aec11f16de0ffeecdaebda4c835ff54f8398f9
CREATE TABLE "archive"."embargoes" (
  "archive_code" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "catalogue_number" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "expires_at" pg_catalog.timestamptz NOT NULL,
  "status" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'active'
);

-- questpie-step: 9301c04c498a92009633ad2e03bf1939ad2640cc7d22dc61dfc958acf3fd01b7
CREATE TABLE "archive"."institutions" (
  "code" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "name" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "tenant_id" pg_catalog.uuid NOT NULL
);

-- questpie-step: 438df90b6bea52b7ab65f25b8899c7fbd0f6150ef2f1dda8ea3d851325330d82
CREATE TABLE "archive"."provenance" (
  "archive_code" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "catalogue_number" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "kind" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "note" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "recorded_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  "sequence" pg_catalog.int4 NOT NULL
);

-- questpie-step: 16de44c511c838ae3a359af20be7e48936c31510157011df52d30b82a0d0dbe4
CREATE TABLE "archive"."records" (
  "archive_code" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "body" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "catalogue_number" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "created_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  "title" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "visibility" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'restricted'
);

-- questpie-step: 86c6fdb01f54730611e23d01f60ec374965e8aa9f733c37e28926bf0fe378066
CREATE TABLE "archive"."research_permits" (
  "archive_code" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "may_deposit" pg_catalog.bool NOT NULL DEFAULT FALSE,
  "may_view_restricted" pg_catalog.bool NOT NULL DEFAULT FALSE,
  "principal_id" pg_catalog.uuid NOT NULL,
  "programme_code" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "status" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'active'
);

-- questpie-step: df6a52c1ef0fe4f97c2f68d9b20c0dfb4af101517077537ad7aa5b72933d2f0b
ALTER TABLE "archive"."embargoes" ADD CONSTRAINT "qp_pk_embargoes_primary" PRIMARY KEY ("archive_code", "catalogue_number");

-- questpie-step: 4cb3bd565a81a21d13a04349d686bfdc5038962bc191cf458b8c99544e81e574
ALTER TABLE "archive"."embargoes" ADD CONSTRAINT "qp_ck_embargoes_archive_code_max_length" CHECK ((pg_catalog.char_length("archive_code") <= 32));

-- questpie-step: 0c5c663312a51ac3b255de574e6ee84bfdeefd3c175f9cd56139fecd80175d89
ALTER TABLE "archive"."embargoes" ADD CONSTRAINT "qp_ck_embargoes_archive_code_min_length" CHECK ((pg_catalog.char_length("archive_code") >= 1));

-- questpie-step: 37871fb56a075e41c8abe066d0e4842ec7df70611372484a0117daf666c13625
ALTER TABLE "archive"."embargoes" ADD CONSTRAINT "qp_ck_embargoes_catalogue_number_max_length" CHECK ((pg_catalog.char_length("catalogue_number") <= 80));

-- questpie-step: 6bd20f5813bb36a704b9ea06addfa44d2cf4a9535cdb7f97b65095613b1064f9
ALTER TABLE "archive"."embargoes" ADD CONSTRAINT "qp_ck_embargoes_catalogue_number_min_length" CHECK ((pg_catalog.char_length("catalogue_number") >= 1));

-- questpie-step: 0880bc08da4761ec7afbc6453662eeebf3aed904250af5b1991dfaf4edfcd596
ALTER TABLE "archive"."embargoes" ADD CONSTRAINT "qp_ck_embargoes_status_max_length" CHECK ((pg_catalog.char_length("status") <= 16));

-- questpie-step: f296830b86c59b3622fad7907abb39a20e4da23be2de028fe1c50d05757fad34
ALTER TABLE "archive"."embargoes" ADD CONSTRAINT "qp_ck_embargoes_status_min_length" CHECK ((pg_catalog.char_length("status") >= 1));

-- questpie-step: 8eb0f7e15da042081cba56128c34e99e1a4b8d6fc243db20c9977aa356ca0366
ALTER TABLE "archive"."institutions" ADD CONSTRAINT "qp_pk_institutions_primary" PRIMARY KEY ("code");

-- questpie-step: 211831d7aca11f36fc8e6d0c28575a9ccf6eacd120686e96d7e0a74cd4a3c0aa
ALTER TABLE "archive"."institutions" ADD CONSTRAINT "qp_ck_institutions_code_max_length" CHECK ((pg_catalog.char_length("code") <= 32));

-- questpie-step: 3af76690aebf8ed0ea47fa86d1999b9501b052eb21e0f9c7694385545ddd3bb1
ALTER TABLE "archive"."institutions" ADD CONSTRAINT "qp_ck_institutions_code_min_length" CHECK ((pg_catalog.char_length("code") >= 1));

-- questpie-step: f5c8e31a13ec74aacb2f4c52f2bea858153a584daf8fe7661b2fbbfb541e9c1a
ALTER TABLE "archive"."institutions" ADD CONSTRAINT "qp_ck_institutions_name_max_length" CHECK ((pg_catalog.char_length("name") <= 160));

-- questpie-step: 81516d9cedeec3233050eb684e6e0b261c6df5264ec98a4a43f12c74da01cf0c
ALTER TABLE "archive"."institutions" ADD CONSTRAINT "qp_ck_institutions_name_min_length" CHECK ((pg_catalog.char_length("name") >= 1));

-- questpie-step: cf8f886cb681c4c39d68380f8a21750206835488fdffe124baf9af142ff006b0
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_pk_provenance_primary" PRIMARY KEY ("archive_code", "catalogue_number", "sequence");

-- questpie-step: ef81b8c3bb6c632d4b55cb37de0827649843b6aa3cbb6177ef1874c99bc57d2e
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_ck_provenance_archive_code_max_length" CHECK ((pg_catalog.char_length("archive_code") <= 32));

-- questpie-step: 09884673cefa37b0a842d5ca76a98de3a6545b811aea0f25ba985f297ffb3fd0
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_ck_provenance_archive_code_min_length" CHECK ((pg_catalog.char_length("archive_code") >= 1));

-- questpie-step: c531fc4cc3bb2b7dc7941a500a801018260da38505d9f40286daf7d54b048193
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_ck_provenance_catalogue_number_max_length" CHECK ((pg_catalog.char_length("catalogue_number") <= 80));

-- questpie-step: f426ccf622ac8895cf0aa6f61bd1de4fc6dbadd65527afac40341e021ca03718
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_ck_provenance_catalogue_number_min_length" CHECK ((pg_catalog.char_length("catalogue_number") >= 1));

-- questpie-step: e7791189e9deb363306b18e298b5e3b6dbff1870e4469ec3660e9194f818b1bb
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_ck_provenance_kind_max_length" CHECK ((pg_catalog.char_length("kind") <= 32));

-- questpie-step: d2f6eaff405137ae2687ee8b16172b56a271123038ac6686ed2d6ca37f496c92
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_ck_provenance_kind_min_length" CHECK ((pg_catalog.char_length("kind") >= 1));

-- questpie-step: c3173159341ca61764e765e02918248b031d88af567bde723dff007a622aedaf
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_ck_provenance_note_max_length" CHECK ((pg_catalog.char_length("note") <= 2048));

-- questpie-step: bd3fa6ed1520b1717e8793f3df2431367b286ed181c527f7f015f3872af951e6
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_ck_provenance_note_min_length" CHECK ((pg_catalog.char_length("note") >= 1));

-- questpie-step: 975f3e4fa21654270643ce4d4380f8c4b689b8e62ba3ff1c51dd82d8bf093334
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_ck_provenance_sequence_minimum" CHECK (("sequence" >= 1));

-- questpie-step: b41657395a1b533be492939542a90c205ee38d43ded211e71ff50753a379459b
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_pk_records_primary" PRIMARY KEY ("archive_code", "catalogue_number");

-- questpie-step: 083d32379faa450f8a950bad7372f5225d6e0e5eb6c3a4a43af647a6b5be9879
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_archive_code_max_length" CHECK ((pg_catalog.char_length("archive_code") <= 32));

-- questpie-step: 389a8cf13f1087e3c0d63e4e527c9ca7690c94ccbbaed70475883f8317651fdc
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_archive_code_min_length" CHECK ((pg_catalog.char_length("archive_code") >= 1));

-- questpie-step: 94ef490c43ed2c187287ca6742344184547b4cee68c398b456886412439c7e85
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_body_max_length" CHECK ((pg_catalog.char_length("body") <= 32768));

-- questpie-step: e9c6fda3ccf0d921415a1cb9c9e1742502d654215dc5cf1e80f7b146c81cfeab
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_body_min_length" CHECK ((pg_catalog.char_length("body") >= 1));

-- questpie-step: c1212f0135dc5f31d90adc00b02f957743d175d35c29469c5eaaf65ba948de07
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_catalogue_number_max_length" CHECK ((pg_catalog.char_length("catalogue_number") <= 80));

-- questpie-step: 610af151fef417a51e13c63bd4c6f6e518a0932ab1fbc9cd44a8e3eafd3402b1
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_catalogue_number_min_length" CHECK ((pg_catalog.char_length("catalogue_number") >= 1));

-- questpie-step: 550d43f5b898a200f90cfd69c54c4cdd1b0d916ce26529132b127b3f2f96fc57
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_title_max_length" CHECK ((pg_catalog.char_length("title") <= 240));

-- questpie-step: fb3d5f904eff9c064d2d6916f42db5f69edc02012f34e01fdc6e200feda15558
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_title_min_length" CHECK ((pg_catalog.char_length("title") >= 1));

-- questpie-step: 7069ab9a6e4dec9e77b4b40a05c70843bbc039e488c3162440b93754267b6055
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_visibility_max_length" CHECK ((pg_catalog.char_length("visibility") <= 16));

-- questpie-step: 30ca92ce8b85dad80df7f13f194b53af298cb2cdc38770ef0131a1b25c2ef625
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_ck_records_visibility_min_length" CHECK ((pg_catalog.char_length("visibility") >= 1));

-- questpie-step: 9aae545efe13cfc67a181d72e23cbb808d35a1c95f97799f25093c4589eaa553
ALTER TABLE "archive"."research_permits" ADD CONSTRAINT "qp_pk_research_permits_primary" PRIMARY KEY ("programme_code", "archive_code", "principal_id");

-- questpie-step: d3fea7af78014c327944dd0186571a775095a7308956ed447d1200dfbf4a4008
ALTER TABLE "archive"."research_permits" ADD CONSTRAINT "qp_ck_research_permits_archive_code_max_length" CHECK ((pg_catalog.char_length("archive_code") <= 32));

-- questpie-step: 0065e05bafbe74774ca8142ade32ad28c1e4902fdfb7e187a62c40703471fbfa
ALTER TABLE "archive"."research_permits" ADD CONSTRAINT "qp_ck_research_permits_archive_code_min_length" CHECK ((pg_catalog.char_length("archive_code") >= 1));

-- questpie-step: f4a0d3ff3f72887461f36dcec81dd9f316ffd9102ac523802db8f23a0f2714f2
ALTER TABLE "archive"."research_permits" ADD CONSTRAINT "qp_ck_research_permits_programme_code_max_length" CHECK ((pg_catalog.char_length("programme_code") <= 64));

-- questpie-step: aa6bc14de791404529baa66a9764fc39b8f0146b212b99c661b09961db1cf019
ALTER TABLE "archive"."research_permits" ADD CONSTRAINT "qp_ck_research_permits_programme_code_min_length" CHECK ((pg_catalog.char_length("programme_code") >= 1));

-- questpie-step: 5ce156fc49b83267028045ee5782d36a790202d407e6ae9ea229a3be37edd4f5
ALTER TABLE "archive"."research_permits" ADD CONSTRAINT "qp_ck_research_permits_status_max_length" CHECK ((pg_catalog.char_length("status") <= 16));

-- questpie-step: 6d2fb1e6c8eec448a360ddbd831450933ce68a0ec9aa5af726a33c88f2fcbe52
ALTER TABLE "archive"."research_permits" ADD CONSTRAINT "qp_ck_research_permits_status_min_length" CHECK ((pg_catalog.char_length("status") >= 1));

-- questpie-step: ca0ea28db0aee23a0fc7781e549da300ae3da238e2f44fb9e4f440c1d040dd6f
ALTER TABLE "archive"."embargoes" ADD CONSTRAINT "qp_fk_embargoes_record" FOREIGN KEY ("archive_code", "catalogue_number") REFERENCES "archive"."records" ("archive_code", "catalogue_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: c773b0ba2990948f694f8cd507b4d27e456058338dfa75df4ab3870e23d356b4
ALTER TABLE "archive"."provenance" ADD CONSTRAINT "qp_fk_provenance_record" FOREIGN KEY ("archive_code", "catalogue_number") REFERENCES "archive"."records" ("archive_code", "catalogue_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 4799ab532365b5f69e0fb51549b15d9322a8ba0e71f1188a1bc2cfd76eba5258
ALTER TABLE "archive"."records" ADD CONSTRAINT "qp_fk_records_institution" FOREIGN KEY ("archive_code") REFERENCES "archive"."institutions" ("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 222cce79641a72b16f7d453b77a4977a1360bac9dcb188740eb586af8961ec5e
ALTER TABLE "archive"."research_permits" ADD CONSTRAINT "qp_fk_research_permits_institution" FOREIGN KEY ("archive_code") REFERENCES "archive"."institutions" ("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 83ac5a88c21f526ca154fbd53ee1354c8ecff3387bd7d79c88d78e88791ddbc4
CREATE INDEX "qp_ix_provenance_page" ON "archive"."provenance" USING btree ("archive_code" ASC NULLS LAST, "catalogue_number" ASC NULLS LAST, "sequence" ASC NULLS LAST);

-- questpie-step: 3a07b2fb5f99d4d52fa37e3f0e5c8d48855dba0936081aa0a4c7214486ee2d00
CREATE INDEX "qp_ix_records_page" ON "archive"."records" USING btree ("archive_code" ASC NULLS LAST, "catalogue_number" DESC NULLS LAST);

-- questpie-step: a2f5ff43dcfb90f4fd317831f8ad371042e43b6d9cd66fa7e88660ab46bda629
CREATE TRIGGER embargoes_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON archive.embargoes
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('archive', 'collection:embargoes', 'archive_code', 'catalogue_number');

CREATE TRIGGER embargoes_questpie_capture_truncate
AFTER TRUNCATE ON archive.embargoes
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('archive', 'collection:embargoes');

CREATE TRIGGER provenance_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON archive.provenance
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('archive', 'collection:provenance', 'archive_code', 'catalogue_number', 'sequence');

CREATE TRIGGER provenance_questpie_capture_truncate
AFTER TRUNCATE ON archive.provenance
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('archive', 'collection:provenance');

CREATE TRIGGER records_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON archive.records
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('archive', 'collection:records', 'archive_code', 'catalogue_number');

CREATE TRIGGER records_questpie_capture_truncate
AFTER TRUNCATE ON archive.records
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('archive', 'collection:records');

CREATE TRIGGER research_permits_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON archive.research_permits
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('archive', 'collection:researchPermits', 'programme_code', 'archive_code', 'principal_id');

CREATE TRIGGER research_permits_questpie_capture_truncate
AFTER TRUNCATE ON archive.research_permits
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('archive', 'collection:researchPermits');
