import { fileURLToPath } from 'node:url';
import { type Plugin, runnerImport } from 'vite';
import { renderCard } from '#og/render-card.ts';
import type * as ShareCards from '#og/share-cards.tsx';

const SHARE_CARDS_MODULE = fileURLToPath(new URL('./share-cards.tsx', import.meta.url));

/**
 * Through Vite rather than imported beside this plugin: the cards are drawn from the presets,
 * and those read their pages with `?raw`, which only means something to Vite. Loaded afresh
 * each time, so a card edited in dev is the card served on the next request.
 */
async function loadShareCards(root: string): Promise<typeof ShareCards.SHARE_CARDS> {
  const { module } = await runnerImport<typeof ShareCards>(SHARE_CARDS_MODULE, {
    root,
    configFile: false,
    logLevel: 'error',
  });
  return module.SHARE_CARDS;
}

/**
 * Every card drawn once at build time and shipped as a static asset: the pages naming them are
 * prerendered, and a card the worker drew on request would wake it for every link unfurled.
 */
export function shareCards(): Plugin {
  let root = '';

  return {
    name: 'www:share-cards',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      // biome-ignore lint/complexity/useMaxParams: the shape connect calls a middleware with
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0];
        const card = path?.endsWith('.png') ? (await loadShareCards(root)).get(path) : undefined;
        if (card === undefined) {
          next();
          return;
        }
        response.setHeader('content-type', 'image/png');
        response.end(await renderCard(card));
      });
    },
    async generateBundle() {
      if (this.environment.name !== 'client') {
        return;
      }
      for (const [path, card] of await loadShareCards(root)) {
        this.emitFile({ type: 'asset', fileName: path.slice(1), source: await renderCard(card) });
      }
    },
  };
}
