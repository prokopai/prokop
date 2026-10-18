import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * The one label style for a group of things: sidebar groups, settings
 * sections, tool output sections, date groups in history. Sentence case,
 * the smallest text size, muted. Spacing belongs to the caller.
 */
function SectionLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="section-label"
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-2xs font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { SectionLabel }
