-- 0029 — anon holds no privilege on any table in public.
--
-- invites and profiles were created by 0008, before 0018 narrowed the default
-- ACL, and production's old default granted anon ALL on every new table. 0008
-- revoked some of that and 0018 changed only what future tables receive, so
-- on 2026-10-04 production still showed:
--
--     invites    anon  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     profiles   anon  INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--
-- Nothing was reachable. RLS is on and neither table has an anon policy, so
-- `GET /invites` answered `200 []` and a write matched no row. But those were
-- the only tables where anon was kept out by RLS alone rather than by a
-- missing grant. Every other table answers 42501, and a policy is easier to
-- get wrong than a grant is to forget. The local stack showed the remainder,
-- TRUNCATE, REFERENCES and TRIGGER, which is why the RLS suite asserts the
-- grant itself.
--
-- Nothing anon does needs either table directly. peek_invite() is SECURITY
-- DEFINER and reads invites as its owner; registration redeems an invite only
-- after signUp() has returned a session, as authenticated.
--
-- The DO block is the postcondition: it fails the migration if anon still
-- holds anything on any table in public, not only these two, so a table this
-- file does not know about cannot hide behind it.

BEGIN;

REVOKE ALL ON TABLE public.invites  FROM anon;
REVOKE ALL ON TABLE public.profiles FROM anon;

DO $$
DECLARE
    leftover text;
BEGIN
    SELECT string_agg(table_name || ':' || privilege_type, ', ' ORDER BY table_name, privilege_type)
      INTO leftover
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee IN ('anon', 'PUBLIC');
    IF leftover IS NOT NULL THEN
        RAISE EXCEPTION 'anon still holds table privileges in public: %', leftover;
    END IF;
END;
$$;

COMMIT;
