import { Card } from "@/components/ui/card";

/** Placeholder body for admin sections built in later tasks (keeps the nav from 404ing). */
export function ComingSoon({ title, task }: { title: string; task: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">{title}</h1>
      <Card>
        <p className="text-ink-muted">Próximamente (Task {task})</p>
      </Card>
    </section>
  );
}
