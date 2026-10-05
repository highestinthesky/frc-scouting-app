-- 0030 — what a person was in the middle of follows their account.
--
-- Two things lived only in one phone's IndexedDB, under no account at all:
--
--   reminder dismissals   a "you're up" or a manager's note, waved away
--   entry drafts          a half-filled match form, saved as it is typed
--
-- So the next scout to sign in on a shared phone inherited both — another
-- person's dismissals hid reminders meant for them, and another person's
-- half-typed form reopened in front of them — while the same scout moving to a
-- second device started from nothing. The client now scopes both by account
-- locally and mirrors them here.
--
-- ─── own rows only ─────────────────────────────────────────────────────────
--
-- Nobody reads another person's dismissals or drafts, managers included.
-- Neither is an operational record: a dismissal says what one person has
-- already seen, a draft is an observation nobody has submitted. A manager who
-- needs the observation gets it when the scout saves it, as an entry.
--
-- The event check on writes keeps a row tied to an event the writer can
-- actually reach — a member, or a manager/super of it (manages_event covers a
-- super who is on no event) — so the table cannot become storage for events a
-- person has no business in.
--
-- profile_id defaults to auth.uid() and the policy pins it there, so a client
-- that omits it is attributed correctly and one that forges it is refused.
--
-- ─── the client survives this migration being absent ──────────────────────
--
-- Every read and write here is best-effort: a missing table is treated as
-- "keep it on this device", which is exactly what happened before. That is
-- deliberate, after 0020 — a client that needed an unapplied migration broke
-- every write on production for three days. The client can ship first.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reminder_dismissals (
    profile_id    uuid NOT NULL DEFAULT auth.uid()
                  REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    -- A manager reminder's uuid, or an automatic one's stable key such as
    -- 'auto:q15:1234' — automatic reminders have no row of their own.
    reminder_key  text NOT NULL CHECK (char_length(reminder_key) BETWEEN 1 AND 200),
    -- When the reminder stops mattering; the client prunes past it.
    expires_at    timestamptz,
    dismissed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, event_id, reminder_key)
);

CREATE TABLE IF NOT EXISTS public.entry_drafts (
    profile_id  uuid NOT NULL DEFAULT auth.uid()
                REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    -- Which form: "<match>:<team>" as opened, or 'new'. See draft.js.
    slot        text NOT NULL CHECK (char_length(slot) BETWEEN 1 AND 64),
    payload     jsonb NOT NULL,
    -- The saving device's clock, in ms. Newest wins between two devices, and
    -- that comparison is between the devices' own clocks — the same ones the
    -- 12-hour expiry already trusts.
    saved_at    bigint NOT NULL,
    -- A form, not a document. An auto recording is ~500 bytes; this is room for
    -- one with every note filled, not for arbitrary storage.
    CONSTRAINT entry_drafts_payload_size CHECK (octet_length(payload::text) <= 65536),
    PRIMARY KEY (profile_id, event_id, slot)
);

ALTER TABLE public.reminder_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_drafts        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminder_dismissals_own ON public.reminder_dismissals;
CREATE POLICY reminder_dismissals_own ON public.reminder_dismissals
    FOR ALL TO authenticated
    USING (profile_id = (SELECT auth.uid()))
    WITH CHECK (
        profile_id = (SELECT auth.uid())
        AND (public.is_event_member(event_id) OR public.manages_event(event_id))
    );

DROP POLICY IF EXISTS entry_drafts_own ON public.entry_drafts;
CREATE POLICY entry_drafts_own ON public.entry_drafts
    FOR ALL TO authenticated
    USING (profile_id = (SELECT auth.uid()))
    WITH CHECK (
        profile_id = (SELECT auth.uid())
        AND (public.is_event_member(event_id) OR public.manages_event(event_id))
    );

-- Explicit, because 0018 narrowed the defaults: a new table arrives with no
-- grant, and forgetting this line fails loudly rather than over-granting.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_dismissals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entry_drafts        TO authenticated;

-- The 0029 postcondition, restated: anon holds nothing on any table here.
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
