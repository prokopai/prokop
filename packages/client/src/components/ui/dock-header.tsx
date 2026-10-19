import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The row at the top of a dock, panel or view: tab strips, checkout pickers,
 * branch names, toolbars. One height everywhere; `divider` draws the hairline
 * under it when the content below has no edge of its own.
 */
function dockHeaderClassName(divider = false): string {
  return cn(
    "flex h-9 shrink-0 items-center gap-1 px-2",
    divider && "border-b border-border/50"
  )
}

function DockHeader({
  className,
  divider = false,
  ...props
}: React.ComponentProps<"div"> & { divider?: boolean }) {
  return (
    <div
      data-slot="dock-header"
      className={cn(dockHeaderClassName(divider), className)}
      {...props}
    />
  )
}

export { DockHeader, dockHeaderClassName }
