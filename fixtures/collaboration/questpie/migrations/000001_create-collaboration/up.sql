-- questpie-step: 0a2639d77f956d730481b291cfa30df1e1461706a830add7cabb79285385dc7e
CREATE SCHEMA "collaboration";

-- questpie-step: dea052e9089b2c23369926d917da6c2d4986a21842278d49f1a33a4356db6a34
CREATE TABLE "collaboration"."channels" (
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "name" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "space_id" pg_catalog.uuid NOT NULL
);

-- questpie-step: e4d667e8e6312a9e99ae4e2c711f5fcdc447375290a1f13f0a9f217799b285c2
CREATE TABLE "collaboration"."companies" (
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "name" pg_catalog.text COLLATE pg_catalog."C" NOT NULL
);

-- questpie-step: 4e9ee15a9835bfb3fb207ae9b8634b2d553630b544c8eb1ed29edc7e25fa7ec4
CREATE TABLE "collaboration"."memberships" (
  "company_id" pg_catalog.uuid NOT NULL,
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "principal_id" pg_catalog.uuid NOT NULL
);

-- questpie-step: c6d20491f8c5f3f275e52cefeabdac08a9bd068f3eff362f03a34288503a0ee9
CREATE TABLE "collaboration"."messages" (
  "audit_id" pg_catalog.uuid,
  "audited_at" pg_catalog.timestamptz,
  "author_membership_id" pg_catalog.uuid NOT NULL,
  "body" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "channel_id" pg_catalog.uuid NOT NULL,
  "created_at" pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid()
);

-- questpie-step: c93d7e7506aa3de70877ab90a77188cdb157f7370028c5e42dd7d1a1f437311f
CREATE TABLE "collaboration"."spaces" (
  "company_id" pg_catalog.uuid NOT NULL,
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "name" pg_catalog.text COLLATE pg_catalog."C" NOT NULL
);

-- questpie-step: cf938fcce96ef6bb98a5aa3acec612ee6f9b10e6397af98cea72f40c5482786d
ALTER TABLE "collaboration"."channels" ADD CONSTRAINT "qp_pk_channels_primary" PRIMARY KEY ("id");

-- questpie-step: d98a5d02aabfd4ec635a5f226dfeccb3bdf524a6b09e63fc1acd9cc98a50f55a
ALTER TABLE "collaboration"."channels" ADD CONSTRAINT "qp_ck_channels_name_max_length" CHECK ((pg_catalog.char_length("name") <= 120));

-- questpie-step: d69246c7a90767b9d75c62b668fbe40f948b1c0890c30f853d3d226bb772d3bb
ALTER TABLE "collaboration"."channels" ADD CONSTRAINT "qp_ck_channels_name_min_length" CHECK ((pg_catalog.char_length("name") >= 1));

-- questpie-step: 04fef17531d81d39716c55e66d940b1602c585835ecc679cd4f169870239fd01
ALTER TABLE "collaboration"."companies" ADD CONSTRAINT "qp_pk_companies_primary" PRIMARY KEY ("id");

-- questpie-step: f334188289442f30d1b558272091bd3df7a5ba7bf67d86f8c8c0a777f5785753
ALTER TABLE "collaboration"."companies" ADD CONSTRAINT "qp_ck_companies_name_max_length" CHECK ((pg_catalog.char_length("name") <= 120));

-- questpie-step: e47d61f520772a7ecfa31814cea9dde0e2dc5aea32928365ae6e170635e21b44
ALTER TABLE "collaboration"."companies" ADD CONSTRAINT "qp_ck_companies_name_min_length" CHECK ((pg_catalog.char_length("name") >= 1));

-- questpie-step: d89f56f943bedfdba5a6b6dbb9ff01024b2e963772d450b1145e60c23370531b
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_uq_memberships_one_principal_per_company" UNIQUE ("company_id", "principal_id");

-- questpie-step: 1d710084c86d783c8642236255462276b3e6c1ef9dfa4d9114cb2f2fbcba7909
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_pk_memberships_primary" PRIMARY KEY ("id");

-- questpie-step: b6d0ca1fadb9bcf91bb19b160efd3dfd5dbe2a7603dbbf33639503fc1b2b5bbe
ALTER TABLE "collaboration"."messages" ADD CONSTRAINT "qp_pk_messages_primary" PRIMARY KEY ("id");

-- questpie-step: d77ae9d60c91b1695dc4aa240bd8ffce3921f8dda8f018c9e7ff0de1098243f6
ALTER TABLE "collaboration"."messages" ADD CONSTRAINT "qp_ck_messages_body_max_length" CHECK ((pg_catalog.char_length("body") <= 8192));

-- questpie-step: a1465a3e02802bd77d8ba08038d67b981226969da91c3a04b93802c0b2416437
ALTER TABLE "collaboration"."messages" ADD CONSTRAINT "qp_ck_messages_body_min_length" CHECK ((pg_catalog.char_length("body") >= 1));

-- questpie-step: bd3ab3c9d202838b14c7010d55a34744b88db42f90ff5e836bc842e04a872fa5
ALTER TABLE "collaboration"."spaces" ADD CONSTRAINT "qp_pk_spaces_primary" PRIMARY KEY ("id");

-- questpie-step: a96b881c8b061e6b554044d8d7fe5edac89347fc040966ac3ea5189f3738dda4
ALTER TABLE "collaboration"."spaces" ADD CONSTRAINT "qp_ck_spaces_name_max_length" CHECK ((pg_catalog.char_length("name") <= 120));

-- questpie-step: a140027756b5b6c6ebbd01d9337d36948dbe0ab83980dd1feffc200bb9ecdd0a
ALTER TABLE "collaboration"."spaces" ADD CONSTRAINT "qp_ck_spaces_name_min_length" CHECK ((pg_catalog.char_length("name") >= 1));

-- questpie-step: 32a6acce833f62f43894a023e818f852072e803a615e9ff448c3af43e65bb55d
ALTER TABLE "collaboration"."channels" ADD CONSTRAINT "qp_fk_channels_space" FOREIGN KEY ("space_id") REFERENCES "collaboration"."spaces" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 3bd8b9f908c491caac8c706986d54c0025373eb9ded0e6611083fe13b408b0df
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_fk_memberships_company" FOREIGN KEY ("company_id") REFERENCES "collaboration"."companies" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 5288bc03a8e282eb60c07c04bb5f99af4acd00b369558448e056242554c9f574
ALTER TABLE "collaboration"."messages" ADD CONSTRAINT "qp_fk_messages_author" FOREIGN KEY ("author_membership_id") REFERENCES "collaboration"."memberships" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 5c61598d800fa9a421b9442a6bcf43f5cc838a845c76b4dabc571fc4adef7783
ALTER TABLE "collaboration"."messages" ADD CONSTRAINT "qp_fk_messages_channel" FOREIGN KEY ("channel_id") REFERENCES "collaboration"."channels" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 6b2b98f0eb6dff50933547f341a2664f5fa28b5a05a4ae1e23e18c77eb314b29
ALTER TABLE "collaboration"."spaces" ADD CONSTRAINT "qp_fk_spaces_company" FOREIGN KEY ("company_id") REFERENCES "collaboration"."companies" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- questpie-step: 08945bc5a026d54215fe4af948733814093bf337302893235a8fd4ca6addb3a1
CREATE INDEX "qp_ix_messages_by_audit_id" ON "collaboration"."messages" USING btree ("audit_id" ASC NULLS LAST);
