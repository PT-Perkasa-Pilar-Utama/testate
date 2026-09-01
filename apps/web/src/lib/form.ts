/**
 * Resetting a Formisch form when its dialog opens.
 *
 * `reset` writes the new initial input and then reads it straight back to copy it into the live
 * input. Solid 2 only makes a write visible on a flush, and calling `flush()` inside an effect
 * callback is a no-op it warns about ("Usually the right fix is deleting the call" - Solid's own
 * reactivity-diagnostics skill, which offers `queueMicrotask` for when a drain is genuinely
 * needed). So the reset runs just outside the effect that noticed the dialog opening, where the
 * flush lands and the values actually arrive.
 *
 * Without this an edit dialog prefills with whatever the form was seeded with rather than the
 * record you clicked, and nothing says so: every create path still works.
 */
export function onceSettled(run: () => void): void {
  queueMicrotask(run);
}
