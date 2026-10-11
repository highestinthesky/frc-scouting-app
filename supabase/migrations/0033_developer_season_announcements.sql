-- Announcement is a developer release decision, independent of which season
-- a super selects. Extend the announced-year list in a future migration only
-- after that season's game module is ready in the client.
BEGIN;

CREATE OR REPLACE FUNCTION public.season_is_announced(p_year integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    -- REBUILT is a previous, announced season. BIOCORE remains pending.
    SELECT coalesce(p_year IN (2026), false);
$$;
REVOKE ALL ON FUNCTION public.season_is_announced(integer)
    FROM PUBLIC, anon, authenticated, service_role;

-- Assign the configured status on every selection, including returning to a
-- past season. SECURITY DEFINER allows the trigger to call the private release
-- configuration; its search path is empty and every reference is qualified.
CREATE OR REPLACE FUNCTION public.reset_season_announcement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    NEW.announced := public.season_is_announced(NEW.active_year);
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_season_announcement()
    FROM PUBLIC, anon, authenticated, service_role;

-- Both the table-level and previous column-level grants must be removed.
-- Existing RLS continues to limit season selection to supers.
REVOKE UPDATE ON public.season_settings FROM authenticated;
REVOKE UPDATE (active_year, announced) ON public.season_settings FROM authenticated;
GRANT UPDATE (active_year) ON public.season_settings TO authenticated;

-- Keep the currently selected season and synchronize only its release status.
UPDATE public.season_settings
SET announced = public.season_is_announced(active_year)
WHERE id;

COMMIT;
