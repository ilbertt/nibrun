import { DirectoryListing } from '#components/files/directory-listing.tsx';
import { SuspendedFilesystem } from '#components/files/suspended-filesystem.tsx';
import { UnreadableFilesystem } from '#components/files/unreadable-filesystem.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useFilesystemAvailability } from '#lib/hooks/use-filesystem-availability.ts';

export function DirectoryBrowser() {
  const availability = useFilesystemAvailability(useAppId());

  switch (availability.kind) {
    case 'suspended':
      return <SuspendedFilesystem />;
    case 'unreadable':
      return <UnreadableFilesystem reason={availability.reason} />;
    case 'browsable':
      return <DirectoryListing />;
  }
}
