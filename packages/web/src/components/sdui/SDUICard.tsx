import React, { useEffect, useState } from "react";
import type { StatCardProps, StatDataResponse } from "@platform/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { useImperativeUI } from "@/context/ImperativeUIContext";
import { TrendingUp, DollarSign, Users, Activity } from "lucide-react";
import { QueryProfileSelect } from "./QueryProfileSelect";
import { useQueryProfileSelection } from "@/hooks/use-query-profile-selection";

interface SDUICardProps {
  id: string;
  props: StatCardProps;
  workspaceId: string;
  recipeId: string;
  startDate: string;
  endDate: string;
  /** Parâmetros do Dashboard usados quando não há Área de Trabalho (modo prévia). */
  params?: Record<string, unknown>;
}

export const SDUICard: React.FC<SDUICardProps> = React.memo(({
  id,
  props,
  workspaceId,
  recipeId,
  startDate,
  endDate,
  params,
}) => {
  const [data, setData] = useState<StatDataResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [profileId, setProfileId] = useQueryProfileSelection({
    recipeId,
    workspaceId,
    componentId: id,
    profiles: props.availableProfiles,
  });
  const { refreshSignal } = useImperativeUI();

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    api.workspaces
      .getData(workspaceId, id, {
        recipe_id: recipeId,
        start_date: startDate,
        end_date: endDate,
        params,
        profile_id: profileId,
      })
      .then((res) => {
        if (isMounted && res.type === "stat") {
          setData(res);
        }
      })
      .catch(() => {
        if (isMounted) setData(null);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id, workspaceId, recipeId, startDate, endDate, params, profileId, refreshSignal]);

  const renderIcon = () => {
    switch (props.icon) {
      case "DollarSign":
        return <DollarSign className="size-4 text-muted-foreground" />;
      case "Users":
        return <Users className="size-4 text-muted-foreground" />;
      case "Activity":
        return <Activity className="size-4 text-muted-foreground" />;
      default:
        return <TrendingUp className="size-4 text-muted-foreground" />;
    }
  };

  const formatValue = (val: number | string | undefined) => {
    if (val === undefined || val === null) return "-";
    if (props.format === "currency") {
      return formatCurrency(val);
    }
    if (props.format === "number") return formatNumber(val);
    if (props.format === "percent") return formatPercent(val);
    return String(val);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {props.title}
        </CardTitle>
        <div className="flex items-center gap-2">
          <QueryProfileSelect
            profiles={props.availableProfiles}
            value={profileId}
            onValueChange={setProfileId}
          />
          {renderIcon()}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {formatValue(data?.value)}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
