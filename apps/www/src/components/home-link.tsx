import { NibrunMark } from '@repo/ui/custom/nibrun-mark';
import { Link } from '@tanstack/react-router';

// Composed here rather than reusing `BrandMark`: below `sm` the name sits directly beside the blog
// link, where two words of the same size read as one pair rather than as a brand and a nav item.
export function HomeLink() {
  return (
    <Link
      to="/"
      aria-label="nibrun home"
      className="flex items-center gap-2 rounded-full font-medium text-sm transition-opacity hover:opacity-80"
    >
      <NibrunMark className="size-6" />
      <span className="hidden sm:inline">nibrun</span>
    </Link>
  );
}
