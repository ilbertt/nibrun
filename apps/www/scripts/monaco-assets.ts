import { join } from 'node:path';
import { copyMonacoAssets } from '@repo/sqlite-explorer/monaco-assets';

copyMonacoAssets({ destination: join(import.meta.dirname, '../public/monaco/vs') });
