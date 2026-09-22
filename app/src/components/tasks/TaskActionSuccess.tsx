import { useEffect, useRef, type ReactNode } from 'react';

export function TaskActionSuccess({ children }: { children: ReactNode }) {
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    message.current?.focus();
  }, []);
  return (
    <p ref={message} role="status" tabIndex={-1}>
      {children}
    </p>
  );
}
