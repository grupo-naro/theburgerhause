import type { ReactNode } from "react";

const tones = {
  success: "bg-green-100 text-green-800",
  muted: "bg-slate-100 text-slate-600",
  warning: "bg-cheddar-400/30 text-ink",
  danger: "bg-red-100 text-red-800",
} as const;

export function Badge({ tone = "muted", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
