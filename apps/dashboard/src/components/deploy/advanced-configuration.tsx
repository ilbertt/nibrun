import { DEPLOY_PATH } from '@repo/global-constants';
import { Button } from '@repo/ui/components/button';
import { Link } from '@tanstack/react-router';

/** The way out of the minimal form: the link stops asking for less, and the rest of it appears. */
export function AdvancedConfiguration() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="self-center text-muted-foreground"
      render={
        <Link to={DEPLOY_PATH} search={(previous) => ({ ...previous, minimal: undefined })} />
      }
    >
      Advanced configuration
    </Button>
  );
}
