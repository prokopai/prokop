import * as React from "react"

import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  /** Accessible name when `label` is an icon or abbreviation. */
  title?: string
  disabled?: boolean
}

/**
 * Pick one of two to four short options shown inline: theme mode, workspace
 * or overview, open or merged. Longer lists use `Select`; switching between
 * content panels uses `Tabs`, whose default variant draws the same track and
 * chip as this control (keep the two in step).
 */
function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "default",
  className,
}: {
  label: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: "default" | "sm"
  className?: string
}) {
  return (
    <div
      data-slot="segmented-control"
      role="group"
      aria-label={label}
      className={cn("inline-flex items-center rounded-lg bg-muted p-0.5", className)}
    >
      {options.map(({ value: option, icon: Icon, label: optionLabel, title, disabled }) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          aria-label={title}
          title={title}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            size === "sm" ? "h-6 px-2" : "h-7",
            value === option
              ? "bg-background text-foreground ring-1 ring-foreground/10"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {Icon && <Icon className="size-3.5" />}
          {optionLabel}
        </button>
      ))}
    </div>
  )
}

export { SegmentedControl }
