import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ValueFormatterParams, ICellRendererParams } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import type { PresentationTask } from '../lib/task-mapper';
import { IonBadge } from '@ionic/react';

const StatusCellRenderer = (params: ICellRendererParams<PresentationTask>) => {
  if (!params.data) return null;
  const colorMap: Record<string, string> = {
    todo: 'medium',
    progress: 'primary',
    done: 'success',
    overdue: 'danger',
    open: 'warning',
  };
  const color = colorMap[params.data.statusRaw] || 'medium';
  return <IonBadge color={color}>{params.value}</IonBadge>;
};

const DeptCellRenderer = (params: ICellRendererParams<PresentationTask>) => {
  return <span>{params.value ? params.value.toUpperCase() : '-'}</span>;
};

export default function TaskGrid({ tasks }: { tasks: PresentationTask[] }) {
  const columnDefs = useMemo<ColDef<PresentationTask>[]>(() => [
    { field: 'title', headerName: 'Titlu', flex: 1, minWidth: 200 },
    { 
      field: 'deptId', 
      headerName: 'Departament', 
      width: 130,
      cellRenderer: DeptCellRenderer
    },
    { 
      field: 'deadlineRaw', 
      headerName: 'Termen', 
      width: 140,
      valueFormatter: (params: ValueFormatterParams<PresentationTask>) => params.data?.deadlineLabel || '-',
      comparator: (valueA, valueB) => {
        // Missing dates sort last
        if (!valueA && !valueB) return 0;
        if (!valueA) return 1;
        if (!valueB) return -1;
        return valueA.localeCompare(valueB);
      }
    },
    { 
      field: 'statusLabel', 
      headerName: 'Status', 
      width: 120,
      cellRenderer: StatusCellRenderer
    },
    { field: 'pointsLabel', headerName: 'Puncte', width: 100 }
  ], []);

  return (
    <div className="ag-theme-alpine" style={{ height: '100%', width: '100%' }}>
      <AgGridReact
        rowData={tasks}
        columnDefs={columnDefs}
        domLayout="autoHeight"
      />
    </div>
  );
}
