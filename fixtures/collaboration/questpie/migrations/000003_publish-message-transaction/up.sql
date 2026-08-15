-- questpie-step: 234f3ce9d21f29f8731270be99a0f9f6a8103d39c36a96b811022832f798cffa
CREATE TABLE "collaboration"."message_events" (
  "id" pg_catalog.uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "kind" pg_catalog.text COLLATE pg_catalog."C" NOT NULL,
  "message_id" pg_catalog.uuid NOT NULL,
  "occurred_at" pg_catalog.timestamptz NOT NULL
);

-- questpie-step: 599951d1b4655330f6773b4ab8855433e337bee18468b784799213c4d45559a8
ALTER TABLE "collaboration"."message_events" ADD CONSTRAINT "qp_pk_message_events_primary" PRIMARY KEY ("id");

-- questpie-step: a660ea13ae830c28e149c284832cbf099b6d788242ffae7be145cfa8bc2a2789
ALTER TABLE "collaboration"."message_events" ADD CONSTRAINT "qp_ck_message_events_kind_max_length" CHECK ((pg_catalog.char_length("kind") <= 32));

-- questpie-step: 0ee7f94bec8fed4e761f5ea40d72cb27f919527ae1d9a12dc7aee4f478ed1462
ALTER TABLE "collaboration"."message_events" ADD CONSTRAINT "qp_ck_message_events_kind_min_length" CHECK ((pg_catalog.char_length("kind") >= 1));

-- questpie-step: 5c93931c80b61c68e1aaecb9a289b9159f4ef4a4a345090b3f2c89a7602de9c6
ALTER TABLE "collaboration"."message_events" ADD CONSTRAINT "qp_fk_message_events_message" FOREIGN KEY ("message_id") REFERENCES "collaboration"."messages" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
