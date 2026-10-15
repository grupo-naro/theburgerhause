import { getMenu } from "@/lib/menu/queries";
import { FeaturedCarousel } from "./featured-carousel";
import { MenuBrowser } from "./menu-browser";
import { StatePanel } from "./state-panel";

/** Cached menu -> part of the static shell; streams only when the cache entry has to be refilled. */
export async function MenuContent() {
  const menu = await getMenu();
  if (menu.categories.length === 0) {
    return <StatePanel title="Estamos actualizando nuestra carta">Volvé en unos minutos para ver las novedades.</StatePanel>;
  }
  return (
    <>
      <FeaturedCarousel products={menu.featured} />
      <MenuBrowser menu={menu} />
    </>
  );
}
