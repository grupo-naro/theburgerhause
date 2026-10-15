import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { TrackingSkeleton } from "@/components/tracking/tracking-skeleton";
import { TrackingView } from "@/components/tracking/tracking-view";
import { getDb } from "@/db/client";
import { getCheckoutInfo, getPublicStoreInfo } from "@/lib/menu/queries";
import { getOrderForTracking } from "@/lib/orders/tracking";

export const metadata: Metadata = {
  title: "Tu pedido — The Burger House 828",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Per-request data (the order changes under it), so it all lives behind Suspense. A malformed token
 * is a 404 without a database lookup (see getOrderForTracking); unknown and malformed are identical.
 * Cache-Control / Referrer-Policy for this route are set in next.config.ts.
 */
async function TrackingContent({ params, searchParams }: Props) {
  await connection();
  const { token } = await params;
  const order = await getOrderForTracking(getDb(), token);
  if (!order) notFound();

  const { nuevo } = await searchParams;
  const needsBank = order.paymentMethod === "transfer" && order.paymentStatus === "pending" && order.status !== "cancelado";
  const [store, checkout] = await Promise.all([getPublicStoreInfo(), needsBank ? getCheckoutInfo() : null]);

  return (
    <TrackingView
      token={token}
      order={order}
      store={store}
      bank={checkout ? { bankAlias: checkout.bankAlias, bankCbu: checkout.bankCbu } : null}
      justPlaced={nuevo === "1"}
    />
  );
}

export default function TrackingPage(props: Props) {
  return (
    <Suspense fallback={<TrackingSkeleton />}>
      <TrackingContent {...props} />
    </Suspense>
  );
}
