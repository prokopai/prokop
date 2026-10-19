import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * One thing in a list of its kind (a server, a provider, an agent, a
 * device): a 40px row with an optional tile, the name, one muted status
 * line, and the thing's own controls at the right. With `onToggle` the row
 * opens its details underneath in a recessed strip; the details are
 * `SettingsRow`s indented to the name. Lives inside a `SettingsGroup` box.
 */
interface CollectionRowProps {
  title: React.ReactNode
  /** One muted line: state, kind, counts, joined by " · ". */
  status?: React.ReactNode
  /** A `ProviderTile` or `RowTile` before the name. */
  icon?: React.ReactNode
  /** Makes the name a button that shows or hides the details. */
  onToggle?: () => void
  expanded?: boolean
  /** Makes the name a button that opens the thing elsewhere (an editor); the chevron sits at the right. */
  onOpen?: () => void
  /** Controls at the right: a switch, hover actions. Stay clickable over the toggle. */
  actions?: React.ReactNode
  className?: string
  /** The details, shown under the row while expanded. */
  children?: React.ReactNode
}

function CollectionRow({ title, status, icon, onToggle, expanded = false, onOpen, actions, className, children }: CollectionRowProps) {
  const text = (
    <span className="flex min-w-0 flex-1 flex-col justify-center">
      <span className="truncate text-sm leading-5">{title}</span>
      {status && <span className="truncate text-xs text-muted-foreground">{status}</span>}
    </span>
  )
  return (
    <div data-slot="collection-row" data-expanded={expanded || undefined} className={className}>
      <div
        className={cn(
          "group/collection-row relative flex min-h-10 items-center gap-3 px-3 py-1.5 transition-colors",
          (onToggle || onOpen) && "hover:bg-muted/50 focus-within:bg-muted/50",
        )}
      >
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-1 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            {icon}
            {text}
          </button>
        ) : onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-1 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
            {icon}
            {text}
          </button>
        ) : (
          <>
            {icon}
            {text}
          </>
        )}
        {(actions || onOpen) && (
          <span className="relative z-10 flex shrink-0 items-center gap-1">
            {actions}
            {onOpen && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
          </span>
        )}
      </div>
      {expanded && children && (
        <div
          data-slot="collection-row-details"
          className="flex flex-col divide-y divide-border/50 border-t border-border/50 bg-foreground/[0.025] [&_[data-slot=settings-row]]:pl-(--row-indent)"
          style={{ "--row-indent": icon ? "4.625rem" : "2.375rem" } as React.CSSProperties}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** A neutral 24px tile for a row that has no brand: an icon inside. */
function RowTile({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      data-slot="row-tile"
      className={cn("flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/10 text-foreground shadow-xs [&_svg]:size-3.5", className)}
      {...props}
    />
  )
}

export { CollectionRow, RowTile }
