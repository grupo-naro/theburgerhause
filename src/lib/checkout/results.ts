/** Message shown for a failed action result. A tripped honeypot gets an actionable hint (never mentions bots). */
export const HONEYPOT_MESSAGE = "Recargá la página y probá de nuevo.";

export function failureMessage(result: { code: string; message: string }): string {
  return result.code === "HONEYPOT" ? HONEYPOT_MESSAGE : result.message;
}
