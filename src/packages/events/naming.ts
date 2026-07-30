/** Event naming & versioning conventions. See docs/EVENT_CONVENTIONS.md. */
export const EVENT_VERSION = 1 as const;

/** Build a canonical event name: `{Aggregate}.{PastTenseVerb}`, e.g. `Booking.Confirmed`. */
export function EventName(aggregate: string, verb: string): string {
  return `${aggregate}.${verb}`;
}

/** Parse an event name back into its aggregate + verb. */
export function parseEventName(name: string): { aggregate: string; verb: string } {
  const [aggregate, verb] = name.split(".", 2);
  return { aggregate: aggregate ?? "", verb: verb ?? "" };
}
