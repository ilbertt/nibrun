import { NibrunMark } from '@repo/ui/custom/nibrun-mark';
import { Link } from '@tanstack/react-router';

// Composed here rather than reusing `BrandMark`: on the narrowest screens the header carries four
// labelled controls, and the word is the one thing in it the mark beside it already says.
export function HomeLink() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 rounded-full font-medium text-sm transition-opacity hover:opacity-80"
    >
      <NibrunMark className="size-6" />
      <span className="hidden sm:inline">nibrun</span>
    </Link>
  );
}
