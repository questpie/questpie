-- questpie-step: 671a80e642c01284ad0094dfd38f934ab2a4ed65427407975ca7d9ceed701522
ALTER TABLE "collaboration"."channels" ADD COLUMN "visibility" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'company';

-- questpie-step: bd9871ef17718795961b1febed3fe3b3f737ff88bd02d89a9a327d5f1c7325dd
ALTER TABLE "collaboration"."memberships" ADD COLUMN "role" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'member';

-- questpie-step: 4ce3e4ec7447f0f37325c59adbfe9791d53f6b55dbe8858e393f190ef44f27c6
ALTER TABLE "collaboration"."memberships" ADD COLUMN "scope_key" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'company';

-- questpie-step: 374e1e10d96c732efadad8ba7d7aef00b142d99c5218b580c69711955b9a2cfa
ALTER TABLE "collaboration"."memberships" ADD COLUMN "status" pg_catalog.text COLLATE pg_catalog."C" NOT NULL DEFAULT 'active';

-- questpie-step: 6faa658670fbf6c83a29e2da718d9fc1afc2bd32a0fd6933085132ad9c2d0463
ALTER TABLE "collaboration"."channels" ADD CONSTRAINT "qp_ck_channels_visibility_max_length" CHECK ((pg_catalog.char_length("visibility") <= 16));

-- questpie-step: 522532f9d937f845419caa9b11df50754a70b066ee75724d3fe44976330b22da
ALTER TABLE "collaboration"."channels" ADD CONSTRAINT "qp_ck_channels_visibility_min_length" CHECK ((pg_catalog.char_length("visibility") >= 1));

-- questpie-step: 1a0a8d2b76af8e06bf8f375de501775d291259751341bb9b3ec2d169bffa062c
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_uq_memberships_id_unique" UNIQUE ("id");

-- questpie-step: 855d94795f3e64ade12a8240ad2ef4319f92f876630b71a6e55eff5fda67b544
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_ck_memberships_role_max_length" CHECK ((pg_catalog.char_length("role") <= 32));

-- questpie-step: ca887d43a0d271e532554285c53581d91c24ce47f522916db91ac8a3c0f840d8
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_ck_memberships_role_min_length" CHECK ((pg_catalog.char_length("role") >= 1));

-- questpie-step: e8b14f6c2312b748e41498a81266e1e939d8b34fc75dc24a7717c2046563d529
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_ck_memberships_scope_key_max_length" CHECK ((pg_catalog.char_length("scope_key") <= 63));

-- questpie-step: 1b897be2cffa72210f2ce2fab19e6942be15ab60880ff42a5517f20270690563
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_ck_memberships_scope_key_min_length" CHECK ((pg_catalog.char_length("scope_key") >= 1));

-- questpie-step: cafc6502181ecbef855ce4e0c691b2d5d643506d751fa605864aa5ba88a124a0
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_ck_memberships_status_max_length" CHECK ((pg_catalog.char_length("status") <= 16));

-- questpie-step: b5e979bf9d03ff6c2e6419cc0441e62e202e668cdcb701b4dcc245131c1169a5
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_ck_memberships_status_min_length" CHECK ((pg_catalog.char_length("status") >= 1));

-- questpie-step: be8595f580989aaf3aafa6feb4c9bd851cea89717a863c2d86b5c7b41c814f89
CREATE INDEX "qp_ix_messages_page" ON "collaboration"."messages" USING btree ("channel_id" ASC NULLS LAST, "created_at" DESC NULLS LAST, "id" DESC NULLS LAST);

-- questpie-step: 9f764cf52ca45ee9ab2b6e02bc594b747f37bd1b1722beb04d2b552d5fa2644b
ALTER TABLE "collaboration"."memberships" DROP CONSTRAINT "qp_uq_memberships_one_principal_per_company";

-- questpie-step: b808bd81f3ac8761aea7da35d694e91c2bd15cd93669d5be8df331406a73ed51
ALTER TABLE "collaboration"."memberships" DROP CONSTRAINT "qp_pk_memberships_primary";

-- questpie-step: cb7d9c36b9fdcbae2bffda6044cb93ecb7c490655be07d520d716ca8fda9c921
ALTER TABLE "collaboration"."memberships" ADD CONSTRAINT "qp_pk_memberships_primary" PRIMARY KEY ("company_id", "principal_id", "scope_key");
