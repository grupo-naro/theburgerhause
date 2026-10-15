import Image from "next/image";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 p-8">
      <Image src="/brand/logo-512.webp" alt="The Burger House 828" width={160} height={160} priority />
      <h1 className="font-display text-3xl font-extrabold text-brand-600">The Burger House 828</h1>
      <button className="rounded-full bg-cheddar-400 px-6 py-3 font-bold text-ink">Agregar al pedido</button>
    </main>
  );
}
