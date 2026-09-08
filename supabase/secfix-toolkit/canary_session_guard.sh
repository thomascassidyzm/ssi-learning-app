#!/usr/bin/env bash
#
# Canary for supabase/secfix-toolkit/session_guard.sql  (job #371, Astra claim 2)
#
# The guard is a PostgREST pre-request function on the ONE shared database, so
# it touches every API request dev, staging and production make. This script
# is the only way it ships:
#
#   1. PROVE the function in a ROLLED-BACK transaction, as the real roles with
#      real claims: a live session passes, a dead one is refused with PT401,
#      no session_id passes, a malformed one passes (fail-open), anon passes.
#      Any red here and nothing is applied.
#   2. With --commit: apply session_guard.sql and reload PostgREST.
#   3. SMOKE, through real PostgREST within seconds: anon still reads the
#      public catalogue; the service role still reads; a fresh authenticated
#      session still reads its own learner row; a globally signed-out token is
#      refused with 401 — the whole point.
#   4. Any red in 3 → ROLLBACK (reset the role setting, reload, drop the
#      function) and exit non-zero. Reversal is also the last two lines of
#      session_guard.sql, by hand.
#
# Usage:  ./supabase/secfix-toolkit/canary_session_guard.sh            # prove only
#         ./supabase/secfix-toolkit/canary_session_guard.sh --commit   # prove, apply, smoke, or roll back
#         ./supabase/secfix-toolkit/canary_session_guard.sh --rollback # reverse it
# Creds:  DATABASE_URL (or ../../ssi-dashboard-v7-clean/.env.psql), and for the
#         smoke: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:-$(command -v psql || echo /home/tomcassidy/.local/pg17/bin/psql)}"
if [ -z "${DATABASE_URL:-}" ]; then
  # Same candidates the .cjs canaries beside this use; a worktree is not a sibling of the dashboard repo.
  for ENVPSQL in "${ENVPSQL:-}" "$REPO/../ssi-dashboard-v7-clean/.env.psql" /home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env.psql /home/tomcassidy/ssi-dashboard-v7-clean/.env.psql; do
    [ -n "$ENVPSQL" ] && [ -f "$ENVPSQL" ] || continue
    DATABASE_URL=$(grep -E '^(export )?DATABASE_URL=' "$ENVPSQL" | head -1 | sed -E 's/^(export )?DATABASE_URL=//; s/^"//; s/"$//' | tr -d '\r\n')
    [ -n "$DATABASE_URL" ] && break
  done
fi
[ -n "${DATABASE_URL:-}" ] || { echo "no DATABASE_URL"; exit 2; }
SQL="$HERE/session_guard.sql"
FN_BODY=$(sed -n '/^CREATE OR REPLACE FUNCTION/,/^\$\$;$/p' "$SQL")

rollback() {
  echo "-- ROLLBACK: resetting pgrst.db_pre_request and dropping the guard"
  "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'R'
ALTER ROLE authenticator RESET pgrst.db_pre_request;
NOTIFY pgrst, 'reload config';
DROP FUNCTION IF EXISTS public.cs_session_guard();
R
  echo "   rolled back"
}
if [ "${1:-}" = "--rollback" ]; then rollback; exit 0; fi

echo "== 1. PROVE the guard in a rolled-back transaction"
LIVE=$("$PSQL" "$DATABASE_URL" -Atc "select id from auth.sessions order by created_at desc limit 1")
OUT=$("$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -At <<EOSQL 2>&1
BEGIN;
$FN_BODY
GRANT EXECUTE ON FUNCTION public.cs_session_guard() TO anon, authenticated, service_role;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","session_id":"$LIVE"}', true);
SELECT public.cs_session_guard(); SELECT 'LIVE_OK';
SELECT set_config('request.jwt.claims', '{"role":"authenticated","session_id":"00000000-0000-0000-0000-000000000000"}', true);
SAVEPOINT s; SELECT public.cs_session_guard(); ROLLBACK TO s;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT public.cs_session_guard(); SELECT 'NOSID_OK';
SELECT set_config('request.jwt.claims', '{"role":"authenticated","session_id":"not-a-uuid"}', true);
SELECT public.cs_session_guard(); SELECT 'MALFORMED_OK';
RESET ROLE; SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT public.cs_session_guard(); SELECT 'ANON_OK';
ROLLBACK;
EOSQL
)
for want in LIVE_OK NOSID_OK MALFORMED_OK ANON_OK "Session revoked"; do
  grep -q "$want" <<<"$OUT" && echo "   PASS  $want" || { echo "   FAIL  $want"; echo "$OUT"; exit 1; }
done
[ "${1:-}" = "--commit" ] || { echo "== prove-only run complete; add --commit to apply"; exit 0; }

: "${VITE_SUPABASE_URL:?}" "${VITE_SUPABASE_ANON_KEY:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"
echo "== 2. APPLY"
"$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$SQL"
sleep 3
echo "== 3. SMOKE through real PostgREST"
fail=0
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
c=$(code "$VITE_SUPABASE_URL/rest/v1/courses?select=course_code&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY"); [ "$c" = 200 ] && echo "   PASS  anon reads the catalogue ($c)" || { echo "   FAIL  anon read ($c)"; fail=1; }
c=$(code "$VITE_SUPABASE_URL/rest/v1/schools?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"); [ "$c" = 200 ] && echo "   PASS  service role reads ($c)" || { echo "   FAIL  service role read ($c)"; fail=1; }
# a fresh authenticated session, then the same token after a global sign-out
PROBE=$(cd "$REPO" && node --input-type=module -e "
import { createClient } from '@supabase/supabase-js'
const U=process.env.VITE_SUPABASE_URL, S=process.env.SUPABASE_SERVICE_ROLE_KEY, A=process.env.VITE_SUPABASE_ANON_KEY
const svc=createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}})
const email='job371-canary-'+Date.now()+'@ssi-probe.invalid'
const {data:c}=await svc.auth.admin.createUser({email,email_confirm:true}); const uid=c.user.id
try{
  await svc.from('learners').insert({user_id:uid,display_name:'canary'})
  const {data:l}=await svc.auth.admin.generateLink({type:'magiclink',email})
  const {data:s}=await createClient(U,A,{auth:{persistSession:false,autoRefreshToken:false}}).auth.verifyOtp({token_hash:l.properties.hashed_token,type:'magiclink'})
  const tok=s.session.access_token
  const rd=async()=> (await fetch(U+'/rest/v1/learners?select=id&user_id=eq.'+uid,{headers:{apikey:A,Authorization:'Bearer '+tok}})).status
  const before=await rd(); await svc.auth.admin.signOut(tok,'global'); const after=await rd()
  console.log(before+' '+after)
} finally { await svc.from('learners').delete().eq('user_id',uid); await svc.auth.admin.deleteUser(uid) }
")
set -- $PROBE
[ "${1:-}" = 200 ] && echo "   PASS  a live authenticated session reads its own row (${1:-})" || { echo "   FAIL  live session read (${1:-})"; fail=1; }
[ "${2:-}" = 401 ] && echo "   PASS  a globally signed-out token is REFUSED by PostgREST (${2:-})" || { echo "   FAIL  signed-out token still reads (${2:-})"; fail=1; }
if [ "$fail" != 0 ]; then rollback; exit 1; fi
echo "== GREEN. The guard is live. Re-run tools/security/revoked-token-postgrest-probe.ts to see case A pass at the token layer, then ./supabase/snapshot-schema.sh and commit schema.sql."
