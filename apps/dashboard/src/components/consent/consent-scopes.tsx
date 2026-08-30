// What each scope lets the client do, in the owner's terms. A scope with no line here is shown as
// the authorization server named it: this is the wording for scopes we know, not the list of
// scopes that exist, and one added on the api should read as itself until it is given a sentence.
const GRANTS: Record<string, string> = {
  mcp: 'Deploy, suspend and delete your apps, and read their logs and files',
  offline_access: 'Stay connected without asking you again',
};

export function ConsentScopes({ scopes }: { scopes: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {scopes.map((scope) => (
        <li className="flex gap-2 text-sm" key={scope}>
          <span aria-hidden className="text-muted-foreground">
            •
          </span>
          <span>{GRANTS[scope] ?? scope}</span>
        </li>
      ))}
    </ul>
  );
}
