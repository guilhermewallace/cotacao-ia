import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

function Separator({ className, orientation = "horizontal", ...props }: React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      {...props}
    />
  );
}

const alertVariants = cva("flex gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", {
  variants: {
    variant: {
      neutral: "border-border bg-muted/60 text-foreground [&>svg]:text-muted-foreground",
      info: "border-info/20 bg-info-soft text-foreground [&>svg]:text-info",
      success: "border-success/20 bg-success-soft text-foreground [&>svg]:text-success",
      warning: "border-warning/25 bg-warning-soft text-foreground [&>svg]:text-warning",
      danger: "border-danger/20 bg-danger-soft text-foreground [&>svg]:text-danger",
    },
  },
  defaultVariants: { variant: "neutral" },
});

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="status" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Alert, Kbd, Separator, Skeleton };
