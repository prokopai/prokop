import * as React from "react"
import { ChevronRight } from "lucide-react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * One setting: label and description on the left taking the free space,
 * control on the right sized to its content, 36px tall. On phones the
 * control drops under the label and fills the width. `stacked` does the same on every size, for a textarea or a grid of
 * choices. `onClick` turns the row into a button that opens something and
 * ends it with a chevron.
 */
interface SettingsRowProps {
  label: React.ReactNode
  /** One short line under the label, only when the label alone is not enough. */
  description?: React.ReactNode
  /** Id of the control, so the label focuses it. */
  htmlFor?: string
  /** Control fills the width under the label on every size. */
  stacked?: boolean
  /** Makes the row a button that opens something; the control slot shows a chevron. */
  onClick?: () => void
  /** With `onClick`: the row toggles content below it; the chevron turns down when open. */
  expanded?: boolean
  className?: string
  children?: React.ReactNode
}

const rowClassName =
  "grid min-h-9 grid-cols-1 items-center gap-x-4 gap-y-1.5 px-3 py-1.5 in-data-[slot=form-grid]:px-0"

function SettingsRow({
  label,
  description,
  htmlFor,
  stacked = false,
  onClick,
  expanded,
  className,
  children,
}: SettingsRowProps) {
  const labelNode = (
    <div className="flex min-w-0 flex-col justify-center">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-sm leading-5 font-normal">
          {label}
        </Label>
      ) : (
        <span className="text-sm leading-5">{label}</span>
      )}
      {description && (
        <span className="text-xs text-muted-foreground">{description}</span>
      )}
    </div>
  )

  if (onClick) {
    // The label is the button and stretches over the whole row; anything in
    // the control slot (a delete button, a count) sits above it and stays
    // clickable on its own.
    return (
      <div
        data-slot="settings-row"
        className={cn(
          rowClassName,
          "group/settings-row relative transition-colors hover:bg-muted/50 focus-within:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto]",
          className
        )}
      >
        <button
          type="button"
          onClick={onClick}
          aria-expanded={expanded}
          className="min-w-0 text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-1 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          {labelNode}
        </button>
        <span className="relative z-10 flex items-center justify-end gap-1 text-xs text-muted-foreground">
          {children}
          <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
        </span>
      </div>
    )
  }

  return (
    <div
      data-slot="settings-row"
      className={cn(
        rowClassName,
        !stacked && "sm:grid-cols-[minmax(0,1fr)_auto]",
        className
      )}
    >
      {labelNode}
      {children !== undefined && (
        <div
          className={cn(
            "flex min-w-0 items-center",
            stacked ? "w-full" : "sm:justify-end"
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * A stack of `SettingsRow` for a dialog or an inline form: same grid as a
 * settings page, hairlines between rows, no box around them.
 */
function FormGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-grid"
      className={cn("flex flex-col divide-y divide-border/50", className)}
      {...props}
    />
  )
}

export { SettingsRow, FormGrid }
