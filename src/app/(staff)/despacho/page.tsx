import { StaffPlaceholder } from "@/components/staff-placeholder";

// Placeholder: replaced by the real screen in a later sprint.
export default function Page() {
  return <StaffPlaceholder title="Despacho" path="/despacho" roles={["encargada_delivery", "admin"]} needsStation />;
}
