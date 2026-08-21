import React from "react";
import type { DashboardSchemaResponse, UIComponentDef, ActionDef } from "@platform/shared";
import { SDUICard } from "./SDUICard";
import { SDUITable } from "./SDUITable";
import { SDUIChart } from "./SDUIChart";

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
    switch (colSpan) {
      case 1:
        return "col-span-12 md:col-span-1";
      case 2:
        return "col-span-12 md:col-span-2";
      case 3:
        return "col-span-12 md:col-span-3";
      case 4:
        return "col-span-12 md:col-span-4";
      case 5:
        return "col-span-12 md:col-span-5";
      case 6:
        return "col-span-12 md:col-span-6";
      case 7:
        return "col-span-12 md:col-span-7";
      case 8:
        return "col-span-12 md:col-span-8";
      case 9:
        return "col-span-12 md:col-span-9";
      case 10:
        return "col-span-12 md:col-span-10";
      case 11:
        return "col-span-12 md:col-span-11";
      case 12:
      default:
        return "col-span-12";
    }
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

  return (
    <div className="grid grid-cols-12 gap-4 w-full">
      {components.map((comp: UIComponentDef) => (
        <div key={comp.id} className={getColSpanClass(comp.layoutProps?.colSpan)}>
          {renderComponent(comp)}
        </div>
      ))}
    </div>
  );
};
