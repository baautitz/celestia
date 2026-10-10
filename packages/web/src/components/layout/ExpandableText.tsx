import React, { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface ExpandableTextProps {
  children: string;
}

/** Texto limitado a 2 linhas; o botão "Ver mais" só aparece quando o texto realmente é cortado. */
export const ExpandableText: React.FC<ExpandableTextProps> = ({ children }) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setTruncated(el.scrollHeight > el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children, expanded]);

  if (!children) return null;

  return (
    <>
      <p
        ref={ref}
        className={`text-sm text-muted-foreground mt-1 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}
      >
        {children}
      </p>
      {(truncated || expanded) && (
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Ver menos" : "Ver mais"}
        </Button>
      )}
    </>
  );
};
