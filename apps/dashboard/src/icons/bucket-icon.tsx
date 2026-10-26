import type { ComponentProps } from 'react';

export function BucketIcon(props: ComponentProps<'svg'>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 9h14l-2 12H7L5 9Z" />
      <path d="M6 9V8a6 6 0 0 1 12 0v1" />
    </svg>
  );
}
