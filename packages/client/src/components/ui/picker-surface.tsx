import type { ReactNode } from "react"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet"

interface PickerSurfaceProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The element that opens the surface; rendered with `asChild`. */
  trigger: ReactNode
  /** Sheet title on phones; also the popover's accessible name. */
  title: string
  /** One line under the title on phones: the current value. */
  description?: ReactNode
  align?: "start" | "center" | "end"
  side?: "top" | "bottom"
  /** Popover width and padding; defaults to a 320px panel with no padding. */
  className?: string
  children: ReactNode
}

/**
 * A picker that is a popover on desktop and a bottom sheet on phones, with
 * the same body in both. The body is a plain vertical list, so nothing in it
 * needs a second pane or an icon-only mode to survive the phone.
 */
function PickerSurface({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  align = "start",
  side = "top",
  className,
  children,
}: PickerSurfaceProps) {
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-hidden rounded-t-3xl">
          <SheetHeader className="shrink-0 border-b border-border/50 pr-12">
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription className="break-words">{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={8}
        aria-label={title}
        className={cn("w-80 gap-0 p-0", className)}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

export { PickerSurface }
