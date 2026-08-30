/**
 * The browser already validates a form: it knows what is required, what a number's bounds are, and
 * it writes the message. What it does badly is show it, in a bubble that belongs to the browser and
 * not to this app. So the forms carry `novalidate`, and this reads the same answers out of the same
 * API to show them in the app's own voice.
 */
import { createSignal } from "solid-js";

export type FieldErrors = ReadonlyMap<string, string>;

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The label a person sees for a control, so the message can name it. */
function labelOf(field: Field): string {
  const aria = field.getAttribute("aria-label");
  if (aria !== null && aria !== "") return aria;
  const text = (field.labels?.[0]?.textContent ?? "").trim();
  if (text !== "") return text;
  return field.name === "" ? "This field" : field.name;
}

/** Every field the browser considers invalid, by its label, with the browser's own message. */
export function fieldErrors(form: HTMLFormElement): FieldErrors {
  const errors = new Map<string, string>();
  for (const field of form.querySelectorAll<Field>(":invalid")) {
    errors.set(labelOf(field), field.validationMessage);
    field.setAttribute("aria-invalid", "true");
  }
  for (const field of form.querySelectorAll<Field>(":valid")) field.removeAttribute("aria-invalid");
  return errors;
}

export type FormGuard = {
  /** Put on the form: `<form ref={guard.ref} novalidate onSubmit={guard.submit(...)}>`. */
  ref: (element: HTMLFormElement) => void;
  errors: () => FieldErrors;
  /**
   * Stops the submit, asks the browser what it thinks, and answers whether the form may go on.
   * It returns rather than taking a callback so the work stays in the handler, where reading a
   * signal belongs.
   */
  accepts: (event: SubmitEvent) => boolean;
};

/** One of these per form, so every form in the app refuses in the same voice. */
export function createFormGuard(): FormGuard {
  const [form, setForm] = createSignal<HTMLFormElement>();
  const [errors, setErrors] = createSignal<FieldErrors>(new Map());
  return {
    ref: setForm,
    errors,
    accepts: (event) => {
      event.preventDefault();
      const element = form();
      const found = element === undefined ? new Map<string, string>() : fieldErrors(element);
      setErrors(found);
      return found.size === 0;
    },
  };
}
