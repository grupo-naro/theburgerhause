import Image from "next/image";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar · The Burger House 828" };

async function LoginFormWithNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { next } = await searchParams;
  // Untrusted: the action re-validates it with safeNextPath before redirecting.
  return <LoginForm next={typeof next === "string" ? next : ""} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col items-center gap-6 px-4 py-10">
      <Image src="/brand/logo-512.webp" alt="The Burger House 828" width={120} height={120} priority />
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Ingresar</h1>
      <Suspense fallback={null}>
        <LoginFormWithNext searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
