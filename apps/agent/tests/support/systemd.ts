export function systemdUnitProperties({
  id,
  loadState = 'loaded',
  activeState = 'active',
  subState = 'running',
}: {
  id: string;
  loadState?: string;
  activeState?: string;
  subState?: string;
}) {
  return `Id=${id}\nLoadState=${loadState}\nActiveState=${activeState}\nSubState=${subState}`;
}
