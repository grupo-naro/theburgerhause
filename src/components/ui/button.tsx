import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const base =
  "bh-btn inline-flex items-center justify-center gap-1 rounded-full font-display font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-line bg-surface text-ink hover:bg-brand-50",
  ghost: "text-brand-600 hover:bg-brand-50",
  danger: "border border-state-error text-state-error hover:bg-red-50",
};
const sizes: Record<ButtonSize, string> = {
  md: "px-6 py-2.5 text-base",
  sm: "px-3 py-1 text-sm",
};

/** Class string so links (`<Link>`) can look like buttons. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}
