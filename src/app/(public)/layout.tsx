import { Suspense, type ReactNode } from "react";
import { CartProvider } from "@/components/cart/cart-provider";
import { OrderBar } from "@/components/cart/order-bar";
import { PreviousPathTracker } from "@/components/cart/previous-path";
import { ClosedBanner } from "@/components/menu/closed-banner";
import { MenuProvider } from "@/components/menu/menu-provider";
import { MenuSkeleton } from "@/components/menu/menu-skeleton";
import { ShellErrorBoundary } from "@/components/menu/shell-error-boundary";
import { StoreFooter } from "@/components/menu/store-footer";
import { StoreHeader } from "@/components/menu/store-header";
import { StoreHeaderFallback } from "@/components/menu/store-header-fallback";
import { StoreStatusProvider } from "@/components/menu/store-status";
import { ToastProvider } from "@/components/ui/toast";
import { ProductSheetProvider } from "@/components/product/sheet-context";
import { getMenu } from "@/lib/menu/queries";

/**
 * Awaits the CACHED menu (`use cache`, so it belongs to the static shell) and hands the serializable
 * value to client code once. It only suspends when the cache entry has to be refilled, hence the
 * Suspense boundary with a shell-shaped fallback in the layout.
 */
async function MenuShell({ children }: { children: ReactNode }) {
  const menu = await getMenu();
  return (
    <MenuProvider menu={menu}>
      <CartProvider>
        <StoreStatusProvider>
          <ToastProvider>
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
            <OrderBar />
            <PreviousPathTracker />
          </ProductSheetProvider>
          </ToastProvider>
        </StoreStatusProvider>
      </CartProvider>
    </MenuProvider>
  );
}

/** Public storefront shell: no auth. Header/footer read cached store info; the closed banner is a dynamic hole. */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <ShellErrorBoundary>
      <Suspense
        fallback={
          <>
            <StoreHeaderFallback />
            <MenuSkeleton />
          </>
        }
      >
        <MenuShell>{children}</MenuShell>
      </Suspense>
    </ShellErrorBoundary>
  );
}
