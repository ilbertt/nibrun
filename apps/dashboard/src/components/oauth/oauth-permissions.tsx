export function OAuthPermissions({ scopes }: { scopes: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-sm">Requested permissions</p>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        {scopes.map((scope) => (
          <li key={scope}>
            {scope === 'mcp'
              ? 'Access your nibrun apps.'
              : scope === 'offline_access'
                ? 'Keep this connection active when you are away.'
                : scope}
          </li>
        ))}
      </ul>
    </div>
  );
}
