"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "outline";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-[10px] text-sm font-semibold transition-all duration-150 focus-visible:outline-none disabled:opacity-50",
          variant === "primary" &&
            "bg-[var(--gold)] text-[#09090a] hover:bg-[var(--gold2)] hover:-translate-y-px active:translate-y-0",
          variant === "ghost" &&
            "bg-white/7 border border-white/10 text-white/52 hover:bg-white/11 hover:text-white/70",
          variant === "outline" &&
            "border border-white/12 text-white/52 hover:border-white/20 hover:text-white/80",
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
export { Button };
