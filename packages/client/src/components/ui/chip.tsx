import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A labeled chip for a session setting under the composer or in a header:
 * an icon and the current value, 24px, rounded. One recipe so the agent,
 * model, checkout, permission and format chips read as one row. Wrap the
 * text in `ChipLabel`. The chips size to the `composer` container, not the
 * viewport: when that container is narrower than 32rem (a phone, or a narrow
 * pane on a wide window) they show their icon only, so a row of them fits
 * without scrolling; the `aria-label` still says the value. An ancestor must
 * declare `@container/composer`.
 */
const chipClassName =
  "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-foreground/6 px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5"

function Chip({ className, ...props }: React.ComponentProps<"button">) {
  return <button type="button" data-slot="chip" className={cn(chipClassName, "@max-lg/composer:px-2", className)} {...props} />
}

/** The chip's text and chevron; hidden in a narrow composer where the icon stands alone. */
function ChipLabel({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="chip-label" className={cn("hidden min-w-0 items-center gap-1.5 truncate @lg/composer:inline-flex", className)} {...props} />
}

export { Chip, ChipLabel, chipClassName }
