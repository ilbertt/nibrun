import { PRODUCT_NAME } from '@repo/global-constants';
import { NibrunMark } from '@repo/ui/custom/nibrun-mark';

export function BrandMark() {
  return (
    <div className="flex items-center gap-2 self-center font-medium">
      <NibrunMark className="size-6" />
      {PRODUCT_NAME}
    </div>
  );
}
