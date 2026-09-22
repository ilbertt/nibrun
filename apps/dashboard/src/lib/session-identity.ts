/**
 * Who the session in hand belongs to. Three states rather than a boolean, because the deploy page
 * renders for someone holding no session at all, and asking whether they are anonymous answers no
 * — pressing deploy is what mints them one.
 */
export enum SessionIdentity {
  /** No session at all, which only the public deploy page renders for. */
  Visitor = 'visitor',
  /** better-auth's own word: a session was minted, just never against an account. */
  Anonymous = 'anonymous',
  /** A session with an account behind it, and the only one an app is theirs to change. */
  WithAccount = 'with-account',
}
