# FRC Scouting Application

MADE FOR 3419 ROHAWKS

## Register
Ask one of the captains or a manager if you do not have an account, they will send you an invite code.

## Seasons

A super controls the active year and **Season announced** in Settings. Changing
the year closes scouting. Until announced, Home, scouting, practice, and manager
analysis show: “Check back later after the season is announced.” Accounts and
current-year planning remain available. A game module must be registered in
`src/lib/seasons/` before its year can be announced.

Entries keep their existing structure; one shared `season_settings` row holds
the year and announcement flag. Events, analysis, exports, suggestions, and
sync stay within the active season. The initial setting is 2026, unannounced.
Migration 0032 removes unused 2025 event data; devices remove their 2025 copies
before starting sync on the next app launch.

Run `npm test`, `npm run build`, and `npm run check:sql` for local verification.
With a local Supabase database running, `npm run test:season-rls` verifies real
role permissions and the migration inside a transaction that is rolled back.

## Other Information
This website was made for 3419, and is currently deployed [here](https://scout.rohawks.org).

Any bugs should be reported within the app or DMed to captains.

Created by Haolun Zhang

Please email scouting@rohawks.org for any questions.

Regular updates will be implemented as the season comes. 
