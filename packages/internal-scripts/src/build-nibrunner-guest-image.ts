import { buildNibrunnerGuestImage } from '#shared/nibrunner-guest-image.ts';

const manifest = await buildNibrunnerGuestImage();
console.info(`Built nibrun guest image ${manifest.version}`);
