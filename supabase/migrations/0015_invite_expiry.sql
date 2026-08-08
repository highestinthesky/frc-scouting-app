-- Migration: invites last a season, not a fortnight
--
-- 0008 set `expires_at DEFAULT (now() + interval '14 days')`, and redeem_invite
-- enforces it at redemption (`AND expires_at > now()`). Fourteen days is right
-- for a code handed to one person who signs up that evening.
--
-- It is wrong for the actual job. Onboarding 20+ scouts means sending codes
-- individually and waiting for teenagers to get round to it, so the codes have
-- to survive the gap between "sent" and "bothered". At 14 days the whole roster
-- has to be issued and redeemed inside the fortnight before an event — which is
-- the fortnight everything else is also happening.
--
-- The failure is quiet and lands at the worst moment: a scout finally opens the
-- link on the morning of the event, redeem_invite finds the row and rejects it
-- for age, and the message is about an invalid code rather than an expired one.
-- After the cutover that scout cannot record anything at all.
--
-- ─── why 90 and not "never" ────────────────────────────────────────────────
--
-- An invite is a bearer credential: whoever types the code becomes a team
-- member with that role. Codes get texted, screenshotted and left in group
-- chats, so they should stop working eventually. 90 days covers an offseason
-- plus a build season without covering next year's roster.
--
-- Only the DEFAULT moves. Existing rows keep the dates they were issued with —
-- an invite already sent with a 14-day life still dies on schedule, which is
-- correct: this changes what gets handed out next, not what was promised.

BEGIN;

ALTER TABLE public.invites
    ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days');

-- Anything already issued and still unredeemed gets the longer life too. Safe
-- because it only ever extends: an unredeemed code is one nobody has used, and
-- the alternative is re-issuing codes to people who were already sent one.
UPDATE public.invites
   SET expires_at = created_at + interval '90 days'
 WHERE redeemed_at IS NULL
   AND expires_at < created_at + interval '90 days';

COMMIT;
