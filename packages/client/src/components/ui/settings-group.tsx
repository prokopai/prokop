import * as React from "react"

import { SectionLabel } from "@/components/ui/section-label"
import { cn } from "@/lib/utils"

/**
 * One quiet box of settings rows with a label above it. Rows inside are
 * `SettingsRow`; they are separated by hairlines, never by their own borders.
 * A `description` under the box explains the whole group when one sentence
 * is needed for all of its rows. With an `icon` (a `ProviderTile`, an
 * avatar) the group is one thing among many of its kind, such as an
 * account: the header grows to a 28px row with the icon and a readable name
 * so the eye can find the group by its mark.
 */
function SettingsGroup({
  label,
  icon,
  description,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  label?: React.ReactNode
  icon?: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <section
      data-slot="settings-group"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      {label && icon ? (
        <div data-slot="settings-group-header" className="flex h-7 min-w-0 items-center gap-2 px-1 text-sm font-medium text-foreground">
          {icon}
          {label}
        </div>
      ) : label ? (
        <SectionLabel className="px-1">{label}</SectionLabel>
      ) : null}
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
