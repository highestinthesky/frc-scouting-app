-- One shared season switch; entries keep their existing shape.
-- Approved cleanup is limited to unused 2025 events and their cascading data.
BEGIN;

CREATE TABLE IF NOT EXISTS public.season_settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    active_year integer NOT NULL CHECK (active_year BETWEEN 1992 AND 9999 AND active_year <> 1999),
    announced boolean NOT NULL DEFAULT false
);
INSERT INTO public.season_settings (id, active_year, announced)
VALUES (true, 2026, false) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.season_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.season_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.season_settings TO authenticated;
GRANT UPDATE (active_year, announced) ON public.season_settings TO authenticated;
DROP POLICY IF EXISTS season_settings_read ON public.season_settings;
CREATE POLICY season_settings_read ON public.season_settings
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS season_settings_super_update ON public.season_settings;
CREATE POLICY season_settings_super_update ON public.season_settings
    FOR UPDATE TO authenticated USING (public.is_super()) WITH CHECK (public.is_super());

CREATE OR REPLACE FUNCTION public.reset_season_announcement() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NEW.active_year IS DISTINCT FROM OLD.active_year THEN NEW.announced := false; END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_season_announcement() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS season_settings_reset_announcement ON public.season_settings;
CREATE TRIGGER season_settings_reset_announcement BEFORE UPDATE ON public.season_settings
    FOR EACH ROW EXECUTE FUNCTION public.reset_season_announcement();

CREATE OR REPLACE FUNCTION public.season_event_is_open(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.events e CROSS JOIN public.season_settings s
        WHERE e.id = p_event AND s.id AND s.announced
          AND e.code ~ '^[0-9]{4}[a-z0-9._-]'
          AND left(e.code, 4) = s.active_year::text
    );
$$;
REVOKE ALL ON FUNCTION public.season_event_is_open(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.season_event_is_open(uuid) TO authenticated;

DROP POLICY IF EXISTS entries_evt_insert ON public.entries;
CREATE POLICY entries_evt_insert ON public.entries FOR INSERT TO authenticated
    WITH CHECK (
        public.is_event_member(event_id) AND public.season_event_is_open(event_id)
        AND (submitted_by IS NULL OR submitted_by = (SELECT auth.uid()))
    );
DROP POLICY IF EXISTS entries_evt_update ON public.entries;
CREATE POLICY entries_evt_update ON public.entries FOR UPDATE TO authenticated
    USING (
        public.is_event_member(event_id)
        AND (submitted_by = (SELECT auth.uid()) OR public.manages_event(event_id))
    )
    WITH CHECK (public.is_event_member(event_id) AND public.season_event_is_open(event_id));

-- A manager can prepare the active year's event while scouting is closed.
CREATE OR REPLACE FUNCTION public.create_event(
    p_code text, p_name text, p_starts_on date DEFAULT NULL, p_ends_on date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id uuid;
    v_actor uuid := (SELECT auth.uid());
    v_code text := lower(btrim(p_code));
    v_year integer;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to create an event.' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_manager() OR public.is_super()) THEN
        RAISE EXCEPTION 'Only a manager can create an event.' USING ERRCODE = '42501';
    END IF;
    SELECT active_year INTO v_year FROM public.season_settings WHERE id;
    IF v_code IS NULL OR v_code !~ '^[0-9]{4}[a-z0-9._-]' OR left(v_code, 4) IS DISTINCT FROM v_year::text THEN
        RAISE EXCEPTION 'Choose an event in the active season.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.events (code, name, starts_on, ends_on, created_by)
    VALUES (v_code, btrim(p_name), p_starts_on, p_ends_on, v_actor) RETURNING id INTO v_id;
    INSERT INTO public.event_scouts (event_id, profile_id, added_by) VALUES (v_id, v_actor, v_actor);
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_event(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event(text, text, date, date) TO authenticated;

-- This existing correction RPC is SECURITY DEFINER and therefore needs the
-- same guard explicitly; its observation merge and role check are retained.
CREATE OR REPLACE FUNCTION public.correct_entry_track(p_id uuid, p_track jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event uuid;
BEGIN
    SELECT event_id INTO v_event FROM public.entries WHERE id = p_id;
    IF v_event IS NULL THEN
        RAISE EXCEPTION 'No such entry.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.manages_event(v_event) THEN
        RAISE EXCEPTION 'Only a manager on this event can correct a recording.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.season_event_is_open(v_event) THEN
        RAISE EXCEPTION 'Check back later after the season is announced.' USING ERRCODE = '42501';
    END IF;
    IF p_track IS NOT NULL AND jsonb_typeof(p_track) <> 'object' THEN
        RAISE EXCEPTION 'A recording must be an object, or null to remove it.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.entries SET observations = CASE
        WHEN p_track IS NULL THEN coalesce(observations, '{}'::jsonb) - 'autoTrack'
        ELSE coalesce(observations, '{}'::jsonb) || jsonb_build_object('autoTrack', p_track)
    END WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.correct_entry_track(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_entry_track(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_entry(p_id uuid, p_undo boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event uuid;
BEGIN
    SELECT event_id INTO v_event FROM public.entries WHERE id = p_id;
    IF v_event IS NULL THEN
        RAISE EXCEPTION 'No such entry.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.manages_event(v_event) THEN
        RAISE EXCEPTION 'Only a manager on this event can delete an entry.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.season_event_is_open(v_event) THEN
        RAISE EXCEPTION 'Check back later after the season is announced.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.entries SET deleted_at = CASE WHEN p_undo THEN NULL ELSE now() END WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_entry(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_entry(uuid, boolean) TO authenticated;

-- The existing event foreign keys cascade through entries, plans, picklists,
-- membership, reminders and drafts. Profiles and invitations are independent.
DELETE FROM public.events WHERE lower(btrim(code)) ~ '^2025[a-z0-9._-]';

COMMIT;
