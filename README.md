# FRC Scouting Application

MADE FOR 3419 ROHAWKS

## Register
Ask one of the captains or a manager if you do not have an account, they will send you an invite code.

## Seasons

A super chooses the active season by name in Settings. The selector includes
REBUILT (2026) and BIOCORE (2027). Announcement status is read-only in the app
and controlled by developer migrations. REBUILT is announced by default;
selecting it makes scouting available again. Until announced, Home, scouting, practice, and manager
analysis show: “Check back later after the season is announced.” Accounts and
current-year planning remain available. A game module must be registered in
`src/lib/seasons/` before its season can be announced. BIOCORE is named and
selectable while its game configuration is pending. Events show their season
name and year in the picker, app bar, and event details.

Entries keep their existing structure; one shared `season_settings` row holds
the year and its developer-configured announcement flag. Events, analysis,
exports, suggestions, and sync stay within the active season.
Migration 0033 restricts the app to selecting a season and derives its status
from `season_is_announced()`. To announce a new season, register its game module,
extend that function's year list in a new migration, and synchronize the active
row's announcement status. Apply 0033 before deploying this client.
Migration 0032 removes unused 2025 event data; devices remove their 2025 copies
before starting sync on the next app launch.

## Other Information
This website was made for 3419, and is currently deployed [here](https://scout.rohawks.org).

Any bugs should be reported within the app or DMed to captains.

Created by Haolun Zhang

Please email scouting@rohawks.org for any questions.

Regular updates will be implemented as the season comes. 
