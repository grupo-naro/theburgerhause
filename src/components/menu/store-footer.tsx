import type { ReactNode } from "react";
import { getPublicStoreInfo } from "@/lib/menu/queries";
import { ChatIcon, ClockIcon, PhoneIcon, PinIcon } from "./icons";

const digits = (s: string) => s.replace(/\D/g, "");

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-cheddar-400">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/75">{label}</p>
        <div className="text-base leading-snug">{children}</div>
      </div>
    </li>
  );
}

const link =
  "underline decoration-white/40 underline-offset-4 hover:decoration-cheddar-400 focus-visible:outline-white";

export async function StoreFooter() {
  const info = await getPublicStoreInfo();
  const wa = digits(info.whatsapp);
  const tel = digits(info.storePhone);
  const hasContact = info.storeAddress || tel || wa || info.openingHoursText;

  return (
    <footer className="mt-12 bg-brand-700 text-white">
      <div className="mx-auto max-w-[1100px] px-4 py-10">
        <p className="font-display text-2xl font-extrabold">{info.storeName}</p>
        {hasContact && (
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {info.storeAddress && (
              <Row icon={<PinIcon className="size-4" />} label="Dónde estamos">
                <a
                  className={link}
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.storeAddress)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {info.storeAddress}
                </a>
              </Row>
            )}
            {info.openingHoursText && (
              <Row icon={<ClockIcon className="size-4" />} label="Horarios">
                <span className="whitespace-pre-line">{info.openingHoursText}</span>
              </Row>
            )}
            {tel && (
              <Row icon={<PhoneIcon className="size-4" />} label="Teléfono">
                <a className={link} href={`tel:+${tel}`}>
                  {info.storePhone}
                </a>
              </Row>
            )}
            {wa && (
              <Row icon={<ChatIcon className="size-4" />} label="WhatsApp">
                <a className={link} href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
                  Escribinos
                </a>
              </Row>
            )}
          </ul>
        )}
        <p className="mt-8 border-t border-white/15 pt-5 text-sm text-white/80">
          © {info.storeName}. Pedí online y retirá o recibilo en tu casa.
        </p>
      </div>
    </footer>
  );
}
