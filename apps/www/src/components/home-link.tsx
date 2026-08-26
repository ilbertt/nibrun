import { BrandMark } from '@repo/ui/custom/brand-mark';
import { Link } from '@tanstack/react-router';

export function HomeLink() {
  return (
    <Link to="/" className="rounded-full text-sm transition-opacity hover:opacity-80">
      <BrandMark />
    </Link>
  );
}
