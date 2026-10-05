// Who owns the whole screen right now.
//
// The auto recorder takes the screen over while it is full screen or recording,
// and for those fifteen seconds the field is the only thing a scout should be
// looking at. Reminders are fixed overlays above everything else, and sync
// pulls new ones every few seconds, so before this a manager's fly-by or a
// "you're up" popup could land on top of the field in the middle of auto —
// over the robot the scout was dragging.
//
// ReminderFlyby reads this and holds what arrives until the recorder lets go.
// Nothing is dropped: a held fly-by is not marked as flown, so it flies the
// moment the screen is free, and a popup is simply not rendered until then.

export const screen = $state({ recorder: false });
