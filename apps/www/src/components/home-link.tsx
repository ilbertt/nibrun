import { NibrunMark } from '@repo/ui/custom/nibrun-mark';
import { Link } from '@tanstack/react-router';

// Composed here rather than reusing `BrandMark`: below `sm` the header packs left, and the word
// costs more of that room than it earns beside a mark that already says it.
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
