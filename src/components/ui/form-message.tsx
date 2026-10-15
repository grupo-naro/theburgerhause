/** Form-level feedback. Renders nothing when there is no message. */
export function FormMessage({ children, tone = "error" }: { children?: string | null; tone?: "error" | "success" }) {
  if (!children) return null;
  const color = tone === "error" ? "border-state-error text-state-error bg-red-50" : "border-state-ready text-green-800 bg-green-50";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-2 text-sm font-medium ${color}`}>
      {children}
    </p>
  );
}
