import { useId } from 'react';
import {
  columnFilteringFeature,
  createFilteredRowModel,
  filterFns,
  type SortingState,
  createSortedRowModel,
  columnVisibilityFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Column,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const dataTableFeatures = tableFeatures({
  columnVisibilityFeature,
  columnFilteringFeature,
  filterFns,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

type DataTableColumn<TData extends RowData> = ColumnDef<
  typeof dataTableFeatures,
  TData
>;

type DataTableProps<TData extends RowData> = {
  columns: DataTableColumn<TData>[];
  data: TData[];
  emptyTitle: string;
  emptyDescription?: string;
  filters?: { columnId: string; label: string }[];
  initialSorting?: SortingState;
  rowClassName?: (row: TData) => string;
};

function columnLabel<TData extends RowData>(
  column: Column<typeof dataTableFeatures, TData>,
) {
  const header = column.columnDef.header;
  return typeof header === 'string' ? header : column.id;
}

function sortDirection<TData extends RowData>(
  column: Column<typeof dataTableFeatures, TData>,
) {
  const sorted = column.getIsSorted();
  if (sorted === 'asc') return 'ascending';
  if (sorted === 'desc') return 'descending';
  return 'none';
}

function nextSortLabel<TData extends RowData>(
  column: Column<typeof dataTableFeatures, TData>,
) {
  const direction =
    column.getNextSortingOrder() === 'desc' ? 'descrescător' : 'crescător';
  return `Sortează ${columnLabel(column)} ${direction}`;
}

function SortIcon<TData extends RowData>({
  column,
}: {
  column: Column<typeof dataTableFeatures, TData>;
}) {
  const sorted = column.getIsSorted();
  if (sorted === 'asc') return <ArrowUp aria-hidden="true" />;
  if (sorted === 'desc') return <ArrowDown aria-hidden="true" />;
  return <ChevronsUpDown aria-hidden="true" />;
}

function DataTable<TData extends RowData>({
  columns,
  data,
  emptyTitle,
  emptyDescription,
  filters = [],
  initialSorting = [],
  rowClassName,
}: DataTableProps<TData>) {
  const filterId = useId();
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    initialState: { sorting: initialSorting },
    enableSortingRemoval: false,
    sortDescFirst: false,
  });

  return (
    <div className="space-y-3">
      {filters.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {filters.map(({ columnId, label }) => {
            const column = table.getColumn(columnId);
            if (!column?.getCanFilter()) return null;
            return (
              <label
                key={columnId}
                htmlFor={`${filterId}-${columnId}`}
                className="grid gap-1 text-sm"
              >
                {label}
                <input
                  id={`${filterId}-${columnId}`}
                  type="search"
                  className="min-h-11 rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  value={String(column.getFilterValue() ?? '')}
                  onChange={(event) =>
                    column.setFilterValue(event.target.value)
                  }
                />
              </label>
            );
          })}
        </div>
      )}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const column = header.column;
                return (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    aria-sort={
                      column.getCanSort() ? sortDirection(column) : undefined
                    }
                  >
                    {header.isPlaceholder ? null : column.getCanSort() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 min-w-11"
                        aria-label={nextSortLabel(column)}
                        onClick={column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        <SortIcon column={column} />
                      </Button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className={rowClassName?.(row.original)}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={Math.max(table.getVisibleLeafColumns().length, 1)}
              >
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{emptyTitle}</EmptyTitle>
                    {emptyDescription && (
                      <EmptyDescription>{emptyDescription}</EmptyDescription>
                    )}
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export { DataTable, type DataTableColumn, type DataTableProps };
