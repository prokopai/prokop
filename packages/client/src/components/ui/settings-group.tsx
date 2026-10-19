import * as React from "react"

import { SectionLabel } from "@/components/ui/section-label"
import { cn } from "@/lib/utils"

/**
 * One quiet box of settings rows with a label above it. Rows inside are
 * `SettingsRow`; they are separated by hairlines, never by their own borders.
 * A `description` under the box explains the whole group when one sentence
 * is needed for all of its rows.
 */
function SettingsGroup({
  label,
  description,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  label?: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <section
      data-slot="settings-group"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      {label && <SectionLabel className="px-1">{label}</SectionLabel>}
      <div className="flex flex-col divide-y divide-border/50 rounded-lg border border-border/50">
        {children}
      </div>
      {description && (
        <p className="px-1 text-xs text-muted-foreground">{description}</p>
      )}
    </section>
  )
}

export { SettingsGroup }
