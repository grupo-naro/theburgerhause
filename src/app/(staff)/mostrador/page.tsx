import { StaffPlaceholder } from "@/components/staff-placeholder";

// Placeholder: replaced by the real screen in a later sprint.
export default function Page() {
  return <StaffPlaceholder title="Mostrador" path="/mostrador" roles={["cajera", "admin"]} needsStation />;
}
