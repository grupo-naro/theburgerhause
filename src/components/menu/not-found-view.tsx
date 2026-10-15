import Link from "next/link";
import { StatePanel } from "./state-panel";
import { buttonClass } from "@/components/ui/button";

export function NotFoundView() {
  return (
    <StatePanel
      title="No encontramos esa página"
      actions={
        <Link href="/" className={buttonClass()}>
          Volver a la carta
        </Link>
      }
    >
      Puede que el enlace haya cambiado. Volvé a la carta para seguir pidiendo.
    </StatePanel>
  );
}
