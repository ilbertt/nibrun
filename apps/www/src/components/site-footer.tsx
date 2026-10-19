import {
  PRODUCT_NAME,
  WWW_PRIVACY_PATH,
  WWW_SUPPORT_PATH,
  WWW_TERMS_PATH,
} from '@repo/global-constants';
import { Link } from '@tanstack/react-router';

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-5 border-border/60 border-t px-6 py-8 text-muted-foreground text-sm">
      <Link to="/" className="font-medium transition-colors hover:text-foreground">
        {PRODUCT_NAME}
      </Link>
      <nav aria-label="Support and legal" className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link to={WWW_SUPPORT_PATH} className="transition-colors hover:text-foreground">
          Support
        </Link>
        <Link to={WWW_PRIVACY_PATH} className="transition-colors hover:text-foreground">
          Privacy
        </Link>
        <Link to={WWW_TERMS_PATH} className="transition-colors hover:text-foreground">
          Terms
        </Link>
      </nav>
    </footer>
  );
}
