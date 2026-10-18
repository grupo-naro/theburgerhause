/** Test-only users. Passwords are constants: the e2e database is disposable. */
export type E2ERole = "admin" | "cajera" | "encargada_delivery" | "cocina";

export type E2EUser = {
  role: E2ERole;
  name: string;
  username: string;
  password: string;
  /** Station chosen at login (staff roles only). */
  station?: string;
  /** Where a fresh login lands after the station is chosen. */
  home: string;
};

export const USERS = {
  admin: { role: "admin", name: "Admin E2E", username: "admin", password: "admin-e2e-pass-1", home: "/admin" },
  cajera: {
    role: "cajera",
    name: "Cajera E2E",
    username: "cajera",
    password: "cajera-e2e-pass-1",
    station: "Mostrador 1",
    home: "/mostrador",
  },
  encargada: {
    role: "encargada_delivery",
    name: "Encargada E2E",
    username: "encargada",
    password: "encargada-e2e-pass-1",
    station: "Delivery 1",
    home: "/delivery",
  },
  // The kitchen device: no station, lands straight on the kitchen screen.
  cocina: { role: "cocina", name: "Cocina E2E", username: "cocina", password: "cocina-e2e-pass-1", home: "/cocina" },
} as const satisfies Record<string, E2EUser>;

export type UserKey = keyof typeof USERS;

export const authFile = (key: UserKey) => `e2e/.auth/${key}.json`;
