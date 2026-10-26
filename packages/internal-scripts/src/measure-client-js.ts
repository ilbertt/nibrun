import { resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

type Size = { files: number; raw: number; gzip: number; brotli: number };

const directory = Bun.argv[2];
if (!directory) {
  throw new Error('Usage: measure-client-js <client-build-directory>');
}

const root = resolve(directory);
const html = await Bun.file(resolve(root, 'index.html')).text();
const linkedFiles = new Set<string>();
for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
  const source = tag.match(/(?:src|href)="(\/[^"?#]+\.js)(?:[?#][^"]*)?"/);
  if (source?.[1]) {
    linkedFiles.add(source[1].slice(1));
  }
}

const allFiles = Array.from(new Bun.Glob('**/*.js').scanSync({ cwd: root })).sort();

async function measure(files: Iterable<string>): Promise<Size> {
  const size: Size = { files: 0, raw: 0, gzip: 0, brotli: 0 };
  for (const file of files) {
    const content = await Bun.file(resolve(root, file)).arrayBuffer();
    size.files++;
    size.raw += content.byteLength;
    size.gzip += gzipSync(content).byteLength;
    size.brotli += brotliCompressSync(content).byteLength;
  }
  return size;
}

console.log(
  JSON.stringify(
    {
      directory: root,
      allJavaScript: await measure(allFiles),
      entryHtmlJavaScript: await measure(linkedFiles),
    },
    null,
    2,
  ),
);
