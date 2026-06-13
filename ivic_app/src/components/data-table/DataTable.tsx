import { ArrowDownUp } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Array<Column<T>>;
  rowKey: (row: T) => string | number;
  className?: string;
  selectedKeys?: Array<string | number>;
  showSelectionColumn?: boolean;
  allRowsSelected?: boolean;
  onToggleAllRows?: () => void;
  onToggleRow?: (key: string | number) => void;
  onSelectRow?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  emptyText?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  className = "",
  selectedKeys = [],
  showSelectionColumn,
  allRowsSelected,
  onToggleAllRows,
  onToggleRow,
  onSelectRow,
  onRowDoubleClick,
  emptyText = "暂无数据",
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const sortedRows = useMemo(() => {
    const column = columns.find((item) => item.key === sortKey);
    if (!column?.sortable) {
      return rows;
    }
    return [...rows].sort((left, right) => {
      const leftValue = column.sortValue?.(left) ?? String(column.render(left));
      const rightValue = column.sortValue?.(right) ?? String(column.render(right));
      const result = leftValue > rightValue ? 1 : leftValue < rightValue ? -1 : 0;
      return sortDirection === "asc" ? result : -result;
    });
  }, [columns, rows, sortDirection, sortKey]);

  function toggleSort(column: Column<T>) {
    if (!column.sortable) {
      return;
    }
    if (sortKey === column.key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(column.key);
      setSortDirection("asc");
    }
  }

  const selectable = Boolean(onSelectRow);
  const withSelectionColumn = (showSelectionColumn ?? Boolean(onToggleRow)) && Boolean(onToggleRow);

  return (
    <div className="table-wrap">
      <table className={`data-table ${className}`.trim()}>
        <colgroup>
          {withSelectionColumn && <col style={{ width: "42px" }} />}
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {withSelectionColumn && (
              <th aria-label="选择">
                {onToggleAllRows && (
                  <input
                    aria-label="全选"
                    checked={Boolean(allRowsSelected)}
                    onChange={onToggleAllRows}
                    type="checkbox"
                  />
                )}
              </th>
            )}
            {columns.map((column) => (
              <th key={column.key} className={column.align ?? "left"}>
                <button disabled={!column.sortable} onClick={() => toggleSort(column)} type="button">
                  <span>{column.header}</span>
                  {column.sortable && <ArrowDownUp size={13} />}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const key = rowKey(row);
            const selected = selectedKeys.includes(key);
            return (
              <tr
                key={key}
                className={`${selected ? "selected" : ""}${selectable ? " clickable" : ""}`.trim()}
                onClick={() => onSelectRow?.(row)}
                onDoubleClick={() => onRowDoubleClick?.(row)}
              >
                {withSelectionColumn && (
                  <td>
                    <input
                      checked={selected}
                      onChange={() => onToggleRow?.(key)}
                      onClick={(event) => event.stopPropagation()}
                      type="checkbox"
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column.key} className={column.align ?? "left"}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td className="empty-cell" colSpan={columns.length + (withSelectionColumn ? 1 : 0)}>
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
