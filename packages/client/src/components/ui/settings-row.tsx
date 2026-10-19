import * as React from "react"
import { ChevronRight } from "lucide-react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * One setting: label on the left in a fixed column, control on the right,
 * 36px tall. On phones the control drops under the label and fills the
 * width. `stacked` does the same on every size, for a textarea or a grid of
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
    return (
      <button
        type="button"
        data-slot="settings-row"
        onClick={onClick}
        className={cn(
          rowClassName,
          "w-full text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_auto]",
          className
        )}
      >
        {labelNode}
        <span className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          {children}
          <ChevronRight className="size-3.5" />
        </span>
      </button>
    )
  }

  return (
    <div
      data-slot="settings-row"
      className={cn(
        rowClassName,
        !stacked && "sm:grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)]",
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
