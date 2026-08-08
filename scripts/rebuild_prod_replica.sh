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
run "0013_entries_update_policy" supabase/migrations/0013_entries_update_policy.sql || exit 1
echo
echo "Rebuilt to production's shape as of 2026-08-07."
