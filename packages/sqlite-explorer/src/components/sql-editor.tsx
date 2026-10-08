import type { QueryEditorRef } from '@libredb/studio/components';
import { Button } from '@repo/ui/components/button';
import { LoaderCircleIcon, PlayIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { LoadingEditor } from '#components/loading-editor.tsx';
import type { useSqliteExplorer } from '#hooks/use-sqlite-explorer.ts';

const QueryEditor = lazy(loadQueryEditor);

async function loadQueryEditor() {
  const { QueryEditor } = await import('@libredb/studio/components');
  // LibreDB configures the shared loader at module load, so inject Monaco afterward.
  await import('#lib/monaco.ts');
  return { default: QueryEditor };
}

export function SqlEditor({
  query,
  setQuery,
  run,
  running,
}: Pick<ReturnType<typeof useSqliteExplorer>, 'query' | 'setQuery' | 'run' | 'running'>) {
  const editor = useRef<QueryEditorRef>(null);

  useEffect(() => {
    function executeShortcut(event: Event): void {
      if (event instanceof CustomEvent && typeof event.detail?.query === 'string') {
        void run(event.detail.query);
      }
    }
    window.addEventListener('execute-query', executeShortcut);
    return () => window.removeEventListener('execute-query', executeShortcut);
  }, [run]);

  function execute(): void {
    void run(editor.current?.getEffectiveQuery() ?? query);
  }

  return (
    <>
      <div className="flex items-center justify-between border-border/20 border-b px-4 py-2">
        <span className="text-muted-foreground text-xs">SQL · ⌘ / Ctrl + Enter</span>
        <Button size="sm" onClick={execute} disabled={running || !query.trim()}>
          {running ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          ) : (
            <PlayIcon aria-hidden="true" />
          )}
          {running ? 'Running…' : 'Run query'}
        </Button>
      </div>
      <div className="min-h-48 flex-1 overflow-hidden">
        <Suspense fallback={<LoadingEditor />}>
          <QueryEditor
            ref={editor}
            value={query}
            onChange={setQuery}
            onContentChange={setQuery}
            databaseType="sqlite"
          />
        </Suspense>
      </div>
    </>
  );
}
