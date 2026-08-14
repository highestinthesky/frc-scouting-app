#!/usr/bin/env bash
# Rebuild a local database to PRODUCTION's real shape — not the repo's.
#
# The difference, and the whole reason this exists: `supabase db reset
# --version NNNN` applies 0001, and production has never run 0001.
#
# Sequence mirrors what the live project actually received:
#   live_baseline.sql   the dashboard-built entries table, defects included
#   0002 .. 0007        applied historically
#   0008 (pre-harden)   the 335-line version from d5cb14e
#   0009                applied historically
#   0010                applied 2026-08-07
#   0013                applied 2026-08-07
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIG_0008="${ORIG_0008:-/tmp/0008_original.sql}"   # git show d5cb14e:supabase/migrations/0008_auth.sql > $ORIG_0008
C=supabase_db_FRC_Scouting_Application

run() {
  local label="$1" file="$2" out rc
  # Capture psql's status directly. Piping into grep and testing the pipeline
  # tests GREP's exit code, so a run that emits only NOTICEs reads as a failure.
  out=$(docker exec -i $C psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$file" 2>&1)
  rc=$?
  if [[ $rc -eq 0 ]]; then
    printf '  ok    %s\n' "$label"
  else
    printf '  FAIL  %s\n' "$label"
    printf '%s\n' "$out" | grep -viE '^NOTICE' | sed 's/^/          /'
    return 1
  fi
}

cd "$ROOT" || exit 1

# Empty the public schema first. `supabase db reset --version 0000` does not
# work — it needs a matching migration file — and any --version that does exist
# applies 0001, which is the whole thing being avoided. Dropping the schema
# leaves auth intact, which 0008 needs for its profiles FK.
docker exec $C psql -U postgres -d postgres -q -c "
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON SCHEMA public TO postgres;
  DELETE FROM auth.users;" >/dev/null 2>&1

# Production's PRIVILEGE DEFAULTS, not just its tables.
#
# The live project was created 2026-05-04, before Supabase changed the default
# to always-revoked, so pg_default_acl in schema public reads
#
#     tables anon=arwdDxtm   functions anon=X   sequences anon=rwU
#
# Every new table there is granted ALL to anon automatically. `supabase start`
# uses the CURRENT default and grants nothing, so a replica that copies only the
# schema is wrong about the environment — and a migration that forgets its
# grants passes locally and ships an anon-writable table.
#
# That is the same mistake as rehearsing on `db reset`: right about the tables,
# wrong about the thing underneath them. 0009_picklist.sql is the proof — it
# contains no GRANT statements at all and picklist still ended up reachable by
# anon in production.
#
# 0018 narrows these on production. Reproduce the OLD defaults here so a replica
# built to a pre-0018 state behaves like the project did.
docker exec $C psql -U postgres -d postgres -q -c "
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  " >/dev/null 2>&1

run "live_baseline (dashboard-built entries)" supabase/live_baseline.sql || exit 1
for m in 0002_schedule_and_assignments 0003_reset_event_data 0004_reminders \
         0005_assignment_overrides 0006_tba_event_key 0007_entry_updated_at; do
  run "$m" "supabase/migrations/${m}.sql" || exit 1
done
if [[ ! -f "$ORIG_0008" ]]; then
  git -C "$ROOT" show d5cb14e:supabase/migrations/0008_auth.sql > "$ORIG_0008" || exit 1
fi
run "0008 (pre-hardening, d5cb14e)" "$ORIG_0008" || exit 1
run "0009_picklist"  supabase/migrations/0009_picklist.sql  || exit 1
run "0010_identity"  supabase/migrations/0010_identity.sql  || exit 1
run "0013 (applied out of band, superseded by 0001)" supabase/0013_applied_superseded.sql || exit 1
echo
echo "Rebuilt to production's shape as of 2026-08-07."
