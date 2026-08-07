// Tests for the identity seam.
//   node src/lib/scout-identity.test.mjs
//
// These pin the rule that decides whether two rows describe the same person.
// Getting it wrong does not throw — it silently attributes one scout's work to
// another, or splits one scout into two and halves their coverage.

import {
	scoutRef,
	rowScout,
	sameScout,
	resolveScout,
	identityFields
} from './scout-identity.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

// ─── normalisation happens once, at construction ───────────────────────────
{
	const r = scoutRef('  Ning  ');
	ok('key is trimmed and lowercased', r.key === 'ning');
	ok('label keeps what the human typed, trimmed', r.label === 'Ning');
	ok('no account is null, not undefined', r.profileId === null);

	ok('mixed case collapses to one key', scoutRef('NING').key === scoutRef('ning').key);
	ok('a blank name has an empty key', scoutRef('   ').key === '');
	ok('null survives construction', scoutRef(null).key === '');
	ok('undefined survives construction', scoutRef(undefined).key === '');
	ok('a number is coerced, not crashed on', scoutRef(3419).key === '3419');
}

// ─── the join ───────────────────────────────────────────────────────────────
{
	const a = scoutRef('Ning', 'uuid-a');
	const b = scoutRef('ning', 'uuid-a');
	ok('same account is the same scout', sameScout(a, b));

	// The entire reason for moving to UUIDs. Two people really can share a name.
	const haolun = scoutRef('Ning', 'uuid-a');
	const otherNing = scoutRef('Ning', 'uuid-b');
	ok('different accounts are different scouts, whatever they are called', !sameScout(haolun, otherNing));

	// A row recorded before accounts existed has no UUID and never will. If it
	// stopped matching, a scout's history would vanish from their own coverage.
	const legacy = scoutRef('Ning');
	ok('an account matches its own legacy rows by name', sameScout(haolun, legacy));
	ok('the fallback is case-insensitive', sameScout(scoutRef('NING', 'u'), scoutRef('ning')));
	ok('the fallback ignores surrounding space', sameScout(scoutRef(' Ning ', 'u'), scoutRef('Ning')));

	ok('two accountless scouts match on name', sameScout(scoutRef('Ning'), scoutRef('ning')));
	ok('different names are different scouts', !sameScout(scoutRef('Ning'), scoutRef('Haolun')));

	// Two unknowns are not evidence of one person.
	ok('blank never matches blank', !sameScout(scoutRef(''), scoutRef('')));
	ok('blank never matches a name', !sameScout(scoutRef(''), scoutRef('Ning')));
	ok('a missing ref never matches', !sameScout(null, scoutRef('Ning')));
	ok('two missing refs never match', !sameScout(null, null));
}

// ─── reading identity off a row ────────────────────────────────────────────
{
	// Planning tables carry profile_id...
	const assignment = rowScout({ scout_name: 'Ning', profile_id: 'uuid-a' });
	ok('a planning row reads profile_id', assignment.profileId === 'uuid-a');
	ok('a planning row reads scout_name', assignment.key === 'ning');

	// ...entries carry the same concept under an older name.
	const entry = rowScout({ scout_name: 'Ning', submitted_by: 'uuid-a' });
	ok('an entry row reads submitted_by as the same thing', entry.profileId === 'uuid-a');
	ok('and the two are therefore the same scout', sameScout(assignment, entry));

	// IndexedDB stores camelCase; the wire is snake_case. Both are one person.
	const local = rowScout({ scoutName: 'Ning', submittedBy: 'uuid-a' });
	ok('a local row reads camelCase', local.profileId === 'uuid-a' && local.key === 'ning');
	ok('local and remote shapes agree', sameScout(local, entry));

	const bare = rowScout({ scout_name: 'Ning' });
	ok('a row with no account is still a scout', bare.key === 'ning' && bare.profileId === null);
	ok('an empty row is nobody', rowScout({}).key === '' && rowScout({}).profileId === null);
	ok('a missing row is nobody', rowScout(null).key === '');
	ok('a null profile_id does not become the string "null"', rowScout({ scout_name: 'x', profile_id: null }).profileId === null);
}

// ─── resolving a typed name to an account ──────────────────────────────────
//
// The client-side twin of profile_for_name() in migration 0010, and it has to
// stay conservative in the same way: a wrong UUID silently reattributes
// somebody's work, and unlike a null it is invisible.
{
	const roster = [
		{ id: 'u1', username: 'ning', first_name: 'Haolun', last_name: 'Ning' },
		{ id: 'u2', username: 'alexr', first_name: 'Alex', last_name: 'Rivera' },
		{ id: 'u3', username: 'alexb', first_name: 'Alex', last_name: 'Brown' }
	];

	ok('an exact username resolves', resolveScout('ning', roster) === 'u1');
	ok('username matching ignores case', resolveScout('NING', roster) === 'u1');
	ok('username matching ignores space', resolveScout('  ning  ', roster) === 'u1');
	ok('a full name resolves', resolveScout('Alex Rivera', roster) === 'u2');
	ok('full-name matching ignores case', resolveScout('alex rivera', roster) === 'u2');

	// Two Alexes. Guessing one would be worse than admitting we do not know.
	ok('an ambiguous first name resolves to nobody', resolveScout('Alex', roster) === null);
	ok('an unknown name resolves to nobody', resolveScout('Nobody', roster) === null);
	ok('a blank name resolves to nobody', resolveScout('', roster) === null);
	ok('an empty roster resolves to nobody', resolveScout('ning', []) === null);
	ok('a missing roster resolves to nobody', resolveScout('ning', null) === null);
}

// ─── writing identity onto an outgoing row ─────────────────────────────────
{
	const ref = scoutRef('Ning', 'uuid-a');

	const planning = identityFields(ref);
	ok('a planning write carries the typed name', planning.scout_name === 'Ning');
	ok('a planning write carries the account', planning.profile_id === 'uuid-a');

	// The name is what still joins today, so it is never dropped.
	const unknown = identityFields(scoutRef('Ning'));
	ok('an unresolved scout still writes a name', unknown.scout_name === 'Ning');
	ok('an unresolved scout writes a null account, not a guess', unknown.profile_id === null);

	const entry = identityFields(ref, 'submitted_by');
	ok('an entry write uses submitted_by', entry.submitted_by === 'uuid-a');
	ok('an entry write carries no profile_id column', !Object.hasOwn(entry, 'profile_id'));
	ok('an entry write still carries the name', entry.scout_name === 'Ning');
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
