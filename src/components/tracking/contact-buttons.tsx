import Link from "next/link";
import { ChatIcon, PhoneIcon } from "@/components/menu/icons";
import { buttonClass } from "@/components/ui/button";
import { orderWhatsappLink } from "@/lib/orders/whatsapp";

const digits = (s: string) => s.replace(/\D/g, "");
const tap = "min-h-11 w-full gap-2 px-5 sm:w-auto";

const waClass = `bh-btn inline-flex items-center justify-center rounded-full bg-whatsapp py-2.5 font-display text-base font-bold text-white transition-colors hover:bg-whatsapp-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${tap}`;

/** Green WhatsApp button (hidden without a configured number). Text/background contrast is above 4.5:1. */
export function WhatsappButton({ number, whatsapp }: { number: number; whatsapp: string }) {
  const wa = orderWhatsappLink(whatsapp, number);
  if (!wa) return null;
  return (
    <a data-testid="whatsapp-button" href={wa} target="_blank" rel="noopener noreferrer" className={waClass}>
      <ChatIcon className="size-5" />
      Escribinos por WhatsApp
    </a>
  );
}

/** Optional phone and the way back to the menu; WhatsApp too unless it already sits under the timeline. */
export function ContactButtons({
  number,
  whatsapp,
  phone,
  showPhone,
  showWhatsapp,
}: {
  number: number;
  whatsapp: string;
  phone: string;
  /** The cancelled card also offers a phone call. */
  showPhone: boolean;
  showWhatsapp: boolean;
}) {
  const tel = digits(phone);
  return (
    <div className="flex flex-wrap gap-3">
      {showWhatsapp && <WhatsappButton number={number} whatsapp={whatsapp} />}
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
