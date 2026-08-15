-- Bootstrap extensions required by QUESTPIE framework migrations.
-- Executed by the postgres image on first container start (empty data dir).
-- If the volume already exists, drop it or run these manually:
--   docker exec -it cityportal-postgres psql -U cityportal -d cityportal \
--     -c 'CREATE EXTENSION IF NOT EXISTS "pgcrypto"; CREATE EXTENSION IF NOT EXISTS "pg_trgm";'

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
