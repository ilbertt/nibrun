import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { $ } from 'bun';
import { repoRoot } from '#shared/paths.ts';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.prod.yml'];
// Shell, not TypeScript: these run on the box, which has no Bun.
const ON_BOX_SCRIPTS = ['on_box_deploy.sh', 'ensure_data_volume.sh'];

const requested = Bun.argv[2] ?? 'bundle.tar.gz';
const outputPath = isAbsolute(requested) ? requested : join(repoRoot, requested);

for (const composeFile of COMPOSE_FILES) {
  if (!(await Bun.file(join(repoRoot, composeFile)).exists())) {
    console.error(`Missing ${composeFile} at the repo root — the on-box deploy runs both.`);
    process.exit(1);
  }
}

await mkdir(dirname(outputPath), { recursive: true });

await $`tar czf ${outputPath} -C ${repoRoot} ${COMPOSE_FILES} -C ${join(repoRoot, 'infra/deploy')} ${ON_BOX_SCRIPTS}`;

console.log(outputPath);
