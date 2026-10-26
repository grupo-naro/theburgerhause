import { z } from "@/lib/zod";

/** Manual delay notice input: 5..60 extra minutes in steps of 5, plus a staff-only reason (max 120 chars). */
export const activateDelaySchema = z.object({
  extraMinutes: z
    .number()
    .int()
    .min(5)
    .max(60)
    .refine((m) => m % 5 === 0, "Tiene que ser múltiplo de 5"),
  reason: z.string().trim().min(1).max(120),
});

export type ActivateDelayInput = z.infer<typeof activateDelaySchema>;
