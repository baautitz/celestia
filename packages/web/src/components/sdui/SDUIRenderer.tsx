import React from "react";
import type { DashboardSchemaResponse, UIComponentDef, ActionDef } from "@platform/shared";
import { SDUICard } from "./SDUICard";
import { SDUITable } from "./SDUITable";
import { SDUIChart } from "./SDUIChart";
import styles from "./sdui-grid.module.css";

interface SDUIRendererProps {
  schema: DashboardSchemaResponse;
  workspaceId: string;
  startDate: string;
  endDate: string;
  isWorkspaceClosed?: boolean;
  readOnly?: boolean;
}

export const SDUIRenderer: React.FC<SDUIRendererProps> = ({
  schema,
  workspaceId,
  startDate,
  endDate,
  isWorkspaceClosed = false,
  readOnly = false,
}) => {
  const components = schema.ui?.components || [];
  const rawActions = schema.actions || [];

  const actionsMap: Record<string, ActionDef> = {};
  rawActions.forEach((act) => {
    actionsMap[act.id] = act as unknown as ActionDef;
  });

  const getColSpanClass = (colSpan?: number) => {
    const n = Math.min(12, Math.max(1, colSpan ?? 12));
    switch (n) {
      case 1: return "col-span-12 md:col-span-1";
      case 2: return "col-span-12 md:col-span-2";
      case 3: return "col-span-12 md:col-span-3";
      case 4: return "col-span-12 md:col-span-4";
      case 5: return "col-span-12 md:col-span-5";
      case 6: return "col-span-12 md:col-span-6";
      case 7: return "col-span-12 md:col-span-7";
      case 8: return "col-span-12 md:col-span-8";
      case 9: return "col-span-12 md:col-span-9";
      case 10: return "col-span-12 md:col-span-10";
      case 11: return "col-span-12 md:col-span-11";
      case 12:
      default: return "col-span-12";
    }
  };

  const getRowSpanClass = (rowSpan?: number) => {
    const n = Math.min(12, Math.max(1, rowSpan ?? 1));
    switch (n) {
      case 1: return "row-span-1 md:row-span-1";
      case 2: return "row-span-1 md:row-span-2";
      case 3: return "row-span-1 md:row-span-3";
      case 4: return "row-span-1 md:row-span-4";
      case 5: return "row-span-1 md:row-span-5";
      case 6: return "row-span-1 md:row-span-6";
      case 7: return "row-span-1 md:row-span-7";
      case 8: return "row-span-1 md:row-span-8";
      case 9: return "row-span-1 md:row-span-9";
      case 10: return "row-span-1 md:row-span-10";
      case 11: return "row-span-1 md:row-span-11";
      case 12:
      default: return "row-span-1 md:row-span-12";
    }
  };

  const getGapClass = (gap?: number) => {
    switch (gap) {
      case 2: return "gap-0.5";
      case 4: return "gap-1";
      case 6: return "gap-1.5";
      case 8: return "gap-2";
      case 10: return "gap-2.5";
      case 12: return "gap-3";
      case 16: return "gap-4";
      case 20: return "gap-5";
      case 24: return "gap-6";
      case 32: return "gap-8";
      case 40: return "gap-10";
      case 48: return "gap-12";
      default: return "gap-4";
    }
  };

  const getGridItemClass = (colSpan?: number, rowSpan?: number) => {
    return `${getColSpanClass(colSpan)} ${getRowSpanClass(rowSpan)}`;
  };

  const renderComponent = (comp: UIComponentDef) => {
    switch (comp.component) {
      case "stat_card":
        return (
          <SDUICard
            key={comp.id}
            id={comp.id}
            props={comp.props}
            workspaceId={workspaceId}
            recipeId={schema.id}
            startDate={startDate}
            endDate={endDate}
          />
        );

      case "data_table":
        return (
          <SDUITable
            key={comp.id}
            id={comp.id}
            props={comp.props}
            workspaceId={workspaceId}
            recipeId={schema.id}
            startDate={startDate}
            endDate={endDate}
            availableActions={actionsMap}
            isWorkspaceClosed={isWorkspaceClosed}
            readOnly={readOnly}
          />
        );

      case "bar_chart":
      case "line_chart":
      case "pie_chart":
        return (
          <SDUIChart
            key={comp.id}
            id={comp.id}
            component={comp.component}
            props={comp.props}
            workspaceId={workspaceId}
            recipeId={schema.id}
            startDate={startDate}
            endDate={endDate}
          />
        );

      default: {
        const unknown = comp as unknown as { id: string; component: string };
        return (
          <div key={unknown.id} className="p-4 border border-dashed border-border text-xs text-muted-foreground">
            Componente não suportado: {unknown.component}
          </div>
        );
      }
    }
  };

  const layout = schema.ui?.layout;
  const gapClass = getGapClass(layout?.gap);
  const rowHeight = layout?.rowHeight ?? 140;

  return (
    <div
      className={`${styles.grid} ${gapClass}`}
      style={{ "--sdui-row-h": `${rowHeight}px` } as React.CSSProperties}
    >
      {components.map((comp: UIComponentDef) => (
        <div key={comp.id} className={`${styles.cell} ${getGridItemClass(comp.layoutProps?.colSpan, comp.layoutProps?.rowSpan)}`}>
          {renderComponent(comp)}
        </div>
      ))}
    </div>
  );
};
