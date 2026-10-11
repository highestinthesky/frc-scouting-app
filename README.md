# FRC Scouting Application

MADE FOR 3419 ROHAWKS

## Structure

### Scouts
- Scouts can create and edit files, whereas they will be pushed to cloud sync to be transferred to a manager
- Can only edit files that they have created

### Managers
- Same as scouts for scouting functionality
- Can view all entries in _Manager View_, which helps to visualize the best picks

## Architecture 
This website is directly connected to an **unencrypted** Supabase **free** database, meaning that it will shut down and require manual reactivation after a week of inactivity
**However**, stored data should be safe

All entries are connected to an **event tag**, which is what the website uses to request sync and push files

Furthermore, to acquire schedules for each scout, a TBA (The Blue Alliance) API key is **required**, however it is free and one can acquire one by simply logging in

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

## Developer
This website was made for 3419, and has currently not been deployed for practical use

Created by Haolun Zhang

Email me for any bugs or problems - I will fix them ASAP 

Regular updates will be implemented as the season comes. 
