import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import { PageGrid, type PageGridColumns } from './PageGrid';
import { SectionHeader, type SectionHeaderAction } from './SectionHeader';

/**
 * A band of the page: an optional `SectionHeader` (`h2`) over exactly one
 * `PageGrid`. A `Section` that follows another `Section` sits 32 px below it
 * (header → content inside a page is 24 px; band → band is 32 px). Panels in
 * a band take `level={3}` when the band has a title.
 */
export function Section({
  eyebrow,
  icon,
  title,
  description,
  action,
  control,
  columns = 1,
  as,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  eyebrow?: ReactNode;
  icon?: LucideIcon;
  title?: ReactNode;
  description?: ReactNode;
  action?: SectionHeaderAction;
  control?: ReactNode;
  columns?: PageGridColumns;
  as?: 'div' | 'ul' | 'ol';
  className?: string;
  children?: ReactNode;
  'aria-label'?: string;
}) {
  const titleId = useId();
  const hasHeader = Boolean(
    eyebrow || title || description || action || control,
  );
  return (
    <section
      data-slot="page-section"
      aria-labelledby={title && !ariaLabel ? titleId : undefined}
      aria-label={ariaLabel}
      className={cn('min-w-0 [[data-slot=page-section]+&]:mt-7', className)}
    >
      {hasHeader && (
        <SectionHeader
          eyebrow={eyebrow}
          icon={icon}
          title={title}
          titleId={titleId}
          description={description}
          action={action}
          control={control}
        />
      )}
      <PageGrid columns={columns} as={as}>
        {children}
      </PageGrid>
    </section>
  );
}
