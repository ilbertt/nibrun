import { lazy, Suspense } from 'react';
import { LoadingWorkspace } from '#components/loading-workspace.tsx';
import type { SqliteWorkspace } from '#lib/workspace.ts';

const LibreDbWorkspace = lazy(loadWorkspace);

async function loadWorkspace() {
  const { StudioWorkspace } = await import('@libredb/studio/workspace');
  // LibreDB configures the shared loader at module load, so inject Monaco afterward.
  await import('#lib/monaco.ts');
  return { default: StudioWorkspace };
}

export function StudioWorkspace({ workspace }: { workspace: SqliteWorkspace }) {
  return (
    <Suspense fallback={<LoadingWorkspace />}>
      <LibreDbWorkspace {...workspace.props} className="min-h-0 flex-1" />
    </Suspense>
  );
}
