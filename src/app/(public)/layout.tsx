import { Suspense } from "react";
import { ClosedBanner } from "@/components/menu/closed-banner";
import { StoreFooter } from "@/components/menu/store-footer";
import { StoreHeader, StoreHeaderFallback } from "@/components/menu/store-header";
import { StoreStatusProvider } from "@/components/menu/store-status";
import { ProductSheetProvider } from "@/components/product/sheet-context";

/** Public storefront shell: no auth. Header/footer read cached store info; the closed banner is a dynamic hole. */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <StoreStatusProvider>
      <ProductSheetProvider>
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-cheddar-400 focus:px-4 focus:py-2 focus:font-bold focus:text-ink"
        >
          Saltar al contenido
        </a>
        <Suspense fallback={<StoreHeaderFallback />}>
          <StoreHeader />
        </Suspense>
        <Suspense fallback={null}>
          <ClosedBanner />
        </Suspense>
        <main id="contenido" className="flex-1">
          {children}
        </main>
        <Suspense fallback={null}>
          <StoreFooter />
        </Suspense>
      </ProductSheetProvider>
    </StoreStatusProvider>
  );
}
