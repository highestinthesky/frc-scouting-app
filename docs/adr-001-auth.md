# ADR 001 — Authentication and roles

Status: **accepted, not yet implemented**
Date: 2026-07-29
Supersedes: the account-creation flow in the v6 upgrade doc

Implementation spec for ROADMAP Phase 1. This is a decision record, not a second
plan document — `ROADMAP.md` stays the single plan and points here.

---

## Context

Four things must be true when this ships:

1. **Roles enforced in Postgres.** A scout must not be able to publish a
   schedule even with a hand-crafted request. Hiding UI is not enforcement.
2. **Outsiders locked out.** Today the event code is the only key and it's public
   on TBA, so anyone can read the team's scouting and write junk to it.
3. **Per-person accountability.** Who submitted what, reliably — not a
   free-text `scoutName` anyone can typo.
4. **Recording never blocked.** A scout with an expired token or no signal still
   records. Only sync waits.

And one hard constraint that shapes every decision below:

> **There is no server.** The app is a static SvelteKit build on GitHub Pages.
> The `service_role` key can never appear in the bundle. Anything requiring it
> requires infrastructure we don't have.

## Decisions

| # | Decision |
|---|---|
| 1 | Supabase Auth, **one project**. `auth.users` + a `profiles` table. |
| 2 | **Invite codes, not manager-created accounts.** Scouts self-register. |
| 3 | Login is username + password. Email is **derived**, never looked up. |
| 4 | `session_id` stays as the event partition; auth becomes the security boundary. |
| 5 | Role checks via a hardened `SECURITY DEFINER` function. |
| 6 | Revoking access = deleting the `profiles` row, not the auth user. |
| 7 | Optional real email per profile, purely for self-service password reset. |

---

## 1 · Why invite codes instead of manager-created accounts

The v6 doc has a manager enter a scout's name, the system mint a temporary
password, and the scout activate the account. That flow needs
`supabase.auth.admin.createUser()`, which needs `service_role`, which needs a
server. On a static host it is not implementable without adding an Edge
Function.

Inverting the flow removes the requirement and a whole mechanism with it:

```
Manager:  Accounts → "Invite a scout" → gets a code:  3419-K7QP
Scout:    /register → enters code, picks username + password → done
```

What disappears: temp-password generation, temp-password delivery, the
"activated" flag, and the forced password change on first login. The
information the v6 doc wanted from the activated flag — *has this person
actually signed up yet* — is just `invites.redeemed_at`.

The scout picking their own username was already agreed, and this is the flow
where that costs nothing.

## 2 · Schema

```sql
-- migration 0008_auth.sql   (0007 reserved for capturing `entries`)

create type public.app_role as enum ('scout', 'manager', 'super');

create table public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    username    text        not null,
    first_name  text        not null,
    last_name   text        not null,
    role        public.app_role not null default 'scout',
    -- Optional, and only ever used for password recovery. Not an identifier.
    recovery_email text,
    created_at  timestamptz not null default now(),

    constraint username_shape check (username ~ '^[a-z0-9._-]{3,24}$')
);

-- Uniqueness is a database guarantee, not a UI one. Case-insensitive so
-- HaolunZ and haolunz cannot both exist — a confusion vector, not a security
-- one, but the kind that generates a support request at 7am on a Saturday.
create unique index profiles_username_lower on public.profiles (lower(username));

create table public.invites (
    code        text primary key,
    role        public.app_role not null default 'scout',
    created_by  uuid not null references public.profiles (id),
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null default (now() + interval '14 days'),
    redeemed_at timestamptz,
    redeemed_by uuid references public.profiles (id)
);
```

`entries` gains one column:

```sql
alter table public.entries
    add column submitted_by uuid references public.profiles (id);
-- Existing rows stay null. Null means "recorded before accounts existed."
-- Nothing is deleted and nothing is backfilled with a guess.
```

`scoutName` stays. It is the display name on a row and it is what the
assignment editor matches on; `submitted_by` is the accountability link. Two
different jobs.

## 3 · The role function

```sql
create or replace function public.app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''          -- hardened: no schema-resolution hijacking
as $$
    select role from public.profiles where id = auth.uid()
$$;

revoke all on function public.app_role() from public;
grant execute on function public.app_role() to authenticated;
```

Two details that matter:

- `set search_path = ''` with fully-qualified names. The existing
  `has_manager_token()` uses `SET search_path = public`, which is better than
  nothing but still resolvable. Empty + qualified is the hardened form; worth
  retrofitting onto `has_manager_token()` while we're in here.
- `grant ... to authenticated` only. `anon` cannot call it.

Helper for readability in policies:

```sql
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.app_role() in ('manager', 'super') $$;
```

## 4 · Policies: what changes and what doesn't

`session_id` **stays**. It answers *which event is this row for* and it does that
well — a user works several events a season and the partition is genuine. What
changes is its job: it stops being the security boundary and becomes a filter.

The boundary becomes `to authenticated`. That single change closes the
public-event-code hole, because `anon` loses all access.

Shape, applied to every table:

```sql
-- Read: any authenticated member, scoped to the current event.
create policy entries_read on public.entries
    for select to authenticated
    using (session_id::text = public.current_session_header());

-- Write own data: any authenticated user.
create policy entries_insert on public.entries
    for insert to authenticated
    with check (
        session_id::text = public.current_session_header()
        and submitted_by = auth.uid()      -- can't submit as someone else
    );

-- Manager-only surfaces swap has_manager_token() for is_manager().
create policy schedules_write on public.schedules
    for all to authenticated
    using (session_id::text = public.current_session_header() and public.is_manager())
    with check (session_id::text = public.current_session_header() and public.is_manager());
```

`has_manager_token()` and the passphrase flow get **deleted** once this lands.
Two parallel authorisation systems is how you end up with a hole in one of
them.

`profiles` policies:

```sql
-- Everyone authenticated can read the roster (needed for assignment pickers).
create policy profiles_read on public.profiles for select to authenticated using (true);
-- You may edit yourself; managers may edit anyone's role except their own.
create policy profiles_self_update on public.profiles
    for update to authenticated using (id = auth.uid());
create policy profiles_manager_update on public.profiles
    for update to authenticated
    using (public.is_manager() and id <> auth.uid());
```

That last `id <> auth.uid()` is deliberate: a manager cannot promote
themselves to `super`. Only a `super` can mint a `super` invite.

## 5 · Login without email

Supabase password auth requires an email. Scouts have usernames. Rather than
look the email up — which needs an anon-readable username table, and leaks the
roster — **derive it deterministically on the client**:

```js
// src/lib/auth.svelte.js
const AUTH_EMAIL_DOMAIN = 'scout.invalid';   // RFC 2606: guaranteed unroutable
const emailFor = (username) => `${username.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;

export async function signIn(username, password) {
    return supabase.auth.signInWithPassword({ email: emailFor(username), password });
}
```

No round trip, no lookup table, no leak. Requires **email confirmation disabled**
in the Supabase dashboard, otherwise every signup sits unconfirmed forever.

Consequence worth accepting knowingly: **usernames become immutable.** Changing
one means changing the auth email. If renaming is ever needed it's an admin
operation, not a settings field.

## 6 · Registration, as an RPC

`signUp()` creates the auth user; a `SECURITY DEFINER` RPC creates the profile
and burns the invite in one transaction. No profile means no access, so an auth
user created without a valid invite can log in and see nothing.

```sql
create or replace function public.redeem_invite(
    p_code text, p_username text, p_first text, p_last text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_role public.app_role;
begin
    select role into v_role from public.invites
     where code = upper(trim(p_code))
       and redeemed_at is null
       and expires_at > now()
     for update;                       -- lock: two scouts can't share one code

    if v_role is null then
        raise exception 'That invite code is not valid or has already been used.';
    end if;

    insert into public.profiles (id, username, first_name, last_name, role)
    values (auth.uid(), lower(trim(p_username)), trim(p_first), trim(p_last), v_role);

    update public.invites
       set redeemed_at = now(), redeemed_by = auth.uid()
     where code = upper(trim(p_code));
end;
$$;
```

`for update` is the point of the lock — two scouts redeeming the same code
simultaneously would otherwise both succeed. The unique index on
`lower(username)` handles the other race: two scouts choosing `jsmith` at the
same instant, one gets `23505`, the client shows "that one's taken."

**The client must treat `23505` as a normal outcome, not an error to log.** The
debounced availability check in the form is a courtesy with a read-to-insert
race window; the index is what actually holds.

## 7 · Session handling — the offline rules

```js
createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,          // survives PWA restart
        autoRefreshToken: true,
        detectSessionInUrl: false,     // no OAuth redirects to parse
        storageKey: 'frc-scout-auth'
    }
});
```

Then three rules, which are the whole point:

1. **The IndexedDB write path never checks auth.** `db.js` gains nothing. A
   scout records with an expired token, a revoked account, or no radio at all.
2. **A failed token refresh never signs anyone out.** Wire
   `onAuthStateChange` to update a `syncState` flag and nothing else. There must
   be no path from "refresh failed" to "navigate to /login".
3. **Long refresh-token lifetime** in the dashboard, so one login covers a
   weekend event. Rotation on.

The failure this prevents: a scout in a dead corner of the venue when the
hourly refresh fires, bounced to a login screen holding an unsaved match. That
is strictly worse than today's behaviour, and it is the default if you let a
generic auth guard redirect on token loss.

Route guarding is therefore **presence-of-session**, not validity-of-token:

```js
// Has this device ever logged in? Then let them in and let sync sort itself out.
const hasSession = Boolean(session.access_token || session.refresh_token);
```

## 8 · Password recovery — the honest gap

No real email means no built-in reset. Two paths, neither requiring a server:

- **Preferred:** the profile carries an optional `recovery_email`. If set,
  Supabase's own recovery flow works normally. Offered at registration and in
  Settings, clearly labelled as recovery-only.
- **Fallback:** the manager deletes the `profiles` row and issues a fresh
  invite. Access dies with the profile because every policy keys off it. The
  orphaned `auth.users` row is harmless — it can log in and see nothing.

This is the weakest part of the design and the part most likely to bite: a
teenager forgetting a password at 7am on competition Saturday is a *when*, not
an *if*. The fallback works but costs them their username. If it happens twice
in one season, that's the signal to add one small Edge Function holding
`service_role` and do proper resets — and *only* then, because it's the first
piece of server-side code in the project and that's a threshold worth paying
attention to.

## 9 · Migration order

1. **`0007_entries.sql` — capture what already exists.** The `entries` table
   and its policies live only in the Supabase dashboard; migrations start at
   0002. The repo currently cannot rebuild the database. Dump the live schema
   into a migration *before* touching policies, or there's no known starting
   state and no way back.
2. `0008_auth.sql` — types, `profiles`, `invites`, functions, `submitted_by`.
3. `0009_policies.sql` — swap every policy to `to authenticated`, replace
   `has_manager_token()` with `is_manager()`, drop the passphrase machinery.
4. Client: `auth.svelte.js`, `/login`, `/register`, `/accounts`, guard in
   `+layout.svelte`.
5. Delete `hashManagerToken`, `event-meta.js`'s passphrase functions, and the
   `ManagerPassphrase` component.

**Step 3 is a hard cutover.** Every existing device loses access until it logs
in. With ~15 users and months of runway that is the right trade — a dual-run
window means two authorisation systems live simultaneously, which is how you
get a hole in one. Do it between seasons, not before an event.

## 10 · Bootstrap

Chicken-and-egg: the first `super` needs an invite, and invites need a creator.

Once, by hand in the Supabase dashboard:

1. Auth → Add user → `<you>@scout.invalid`, a password, confirmed.
2. SQL editor: insert a `profiles` row for that uuid with `role = 'super'`.

Documented here because it will need doing again for any fresh environment, and
it is exactly the step that gets forgotten.

## 11 · What this does not solve

- **Shared devices.** If two scouts pass one phone between them, entries are
  attributed to whoever is logged in. Accounts don't fix that; only logging out
  does, and nobody will.
- **A malicious team member.** Anyone with a valid account can write plausible
  junk. Roles stop privilege escalation, not bad data from a legitimate user.
- **Server-side validation of entry contents.** Still absent. A crafted request
  can insert a nonsense entry within its own event. Out of scope here.

## 12 · Test plan

Policies are the part that fails silently, so they get tested directly in SQL
rather than through the UI:

- A `scout` JWT cannot insert into `schedules`, `assignments`, or `invites`.
- A `scout` cannot `update` their own `role`.
- A `manager` cannot set `role = 'super'` on anyone, including themselves.
- `anon` gets zero rows from every table.
- Two concurrent `redeem_invite` calls on one code: exactly one succeeds.
- Two concurrent registrations with the same username: exactly one succeeds,
  the other raises `23505`.
- `insert` with `submitted_by` set to another user's uuid is rejected.

Client-side, the one that matters most:

- Kill the network, record three entries, restore the network. All three
  arrive, and the app never showed a login screen.
