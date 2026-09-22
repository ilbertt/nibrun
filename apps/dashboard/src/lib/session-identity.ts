/**
 * Who the session in hand belongs to. Three states rather than a boolean, because a visitor with
 * no session is not a stranger yet — pressing deploy is what mints one — and the two read the same
 * to anything asking only whether this is anonymous.
 */
export enum SessionIdentity {
  /** No session at all, which only the public deploy page renders for. */
  Visitor = 'visitor',
  /** A session made without an identity: what the api lets one do, it does. */
  Stranger = 'stranger',
  /** Somebody signed in, and the only one an app is theirs to change. */
  Person = 'person',
}
