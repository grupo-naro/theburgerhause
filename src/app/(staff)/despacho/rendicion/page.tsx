import { StaffPlaceholder } from "@/components/staff-placeholder";

// Placeholder for Task 8.5 (the rendicion screen). Exists so "Rendir" on the board never 404s.
export default function Page() {
  return <StaffPlaceholder title="Rendición" path="/despacho/rendicion" roles={["encargada_delivery", "admin"]} needsStation />;
}
