import Link from "next/link";
import { ChatIcon, PhoneIcon } from "@/components/menu/icons";
import { buttonClass } from "@/components/ui/button";
import { orderWhatsappLink } from "@/lib/orders/whatsapp";

const digits = (s: string) => s.replace(/\D/g, "");
const tap = "min-h-11 w-full gap-2 px-5 sm:w-auto";

/** WhatsApp (hidden without a configured number), optional phone and the way back to the menu. */
export function ContactButtons({
  number,
  whatsapp,
  phone,
  showPhone,
}: {
  number: number;
  whatsapp: string;
  phone: string;
  /** The cancelled card also offers a phone call. */
  showPhone: boolean;
}) {
  const wa = orderWhatsappLink(whatsapp, number);
  const tel = digits(phone);
  return (
    <div className="flex flex-wrap gap-3">
      {wa && (
        <a
          data-testid="whatsapp-button"
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonClass("primary")} ${tap}`}
        >
          <ChatIcon className="size-5" />
          Escribinos por WhatsApp
        </a>
      )}
      {showPhone && tel && (
        <a data-testid="phone-button" href={`tel:+${tel}`} className={`${buttonClass("secondary")} ${tap}`}>
          <PhoneIcon className="size-5" />
          Llamar al local
        </a>
      )}
      <Link data-testid="back-to-menu" href="/" className={`${buttonClass("secondary")} ${tap}`}>
        Volver a la carta
      </Link>
    </div>
  );
}
