import { useEffect } from 'react';
import { toast } from 'sonner';

export function useFailureToast(reason: string | undefined): void {
  useEffect(() => {
    if (reason !== undefined) {
      toast.error(reason);
    }
  }, [reason]);
}
