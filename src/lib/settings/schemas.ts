import { z } from "@/lib/zod";

const phone = z
  .string()
  .max(30, "Máximo 30 caracteres")
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(z.string().regex(/^[0-9 +\-()]*$/, "Solo números, espacios, + - y paréntesis"));

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);

export const settingsInputSchema = z.object({
  storeName: z.string().trim().min(1, "Ingresá el nombre del local").max(80, "Máximo 80 caracteres"),
  storeAddress: text(200),
  storePhone: phone,
  whatsapp: phone,
  bankAlias: z
    .string()
    .trim()
    .max(40, "Máximo 40 caracteres")
    .regex(/^[A-Za-z0-9._-]*$/, "Solo letras, números, punto, guion y guion bajo"),
  bankCbu: z
    .string()
    .trim()
    .regex(/^(\d{22})?$/, "El CBU/CVU tiene 22 dígitos, sin espacios"),
  deliveryFeePesos: z
    .number("Ingresá el costo de envío")
    .int("El costo debe ser en pesos enteros")
    .min(0, "No puede ser negativo")
    .max(100_000_000, "Importe demasiado alto"),
  acceptingOrders: z.boolean(),
  openingHoursText: text(500),
  businessDayCutoff: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ingresá una hora entre 00:00 y 23:59 (ej. 06:00)"),
  basePrepMinutes: z
    .number("Ingresá el tiempo base de preparación")
    .int("Ingresá minutos enteros")
    .min(5, "Mínimo 5 minutos")
    .max(180, "Máximo 180 minutos"),
  deliveryTravelMinutes: z
    .number("Ingresá el margen de viaje")
    .int("Ingresá minutos enteros")
    .min(0, "No puede ser negativo")
    .max(120, "Máximo 120 minutos"),
});

export type SettingsInput = z.input<typeof settingsInputSchema>;
