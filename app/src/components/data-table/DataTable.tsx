import {
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
}: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    enableSortingRemoval: false,
    sortDescFirst: false,
  });

  return (
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
            <TableRow key={row.id}>
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
  );
}

export { DataTable, type DataTableColumn, type DataTableProps };
