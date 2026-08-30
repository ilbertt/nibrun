import { NibrunMark } from '@repo/ui/custom/nibrun-mark';
import { Link } from '@tanstack/react-router';

// Composed here rather than reusing `BrandMark`: below 360px the header's five controls overflow,
// and the word is the one thing in it that the mark beside it already says.
export function HomeLink() {
  return (
    <Link
      to="/"
      aria-label="nibrun home"
      className="flex items-center gap-2 rounded-full font-medium text-sm transition-opacity hover:opacity-80"
    >
      <NibrunMark className="size-6" />
      <span className="max-[359px]:hidden">nibrun</span>
    </Link>
  );
}
