import type { Participant } from "@/lib/types";

export default function Cast({ me, people, onDone }: { me: Participant; people: Participant[]; onDone: () => void }) {
  const others = people.filter((p) => p.id !== me.id);
  return (
    <main className="column flex min-h-dvh flex-col px-6 pb-8 pt-14">
      <span className="label">Tonight you are</span>
      <h1 className="display mt-2 text-[52px]">{me.name}</h1>
      <span className="mt-3 h-1.5 w-11 bg-red" />
      <p className="mt-8 text-sm leading-relaxed">Everyone has a nickname this round. These are your friends.</p>
      <ul className="mt-5 flex-1 overflow-y-auto">
        {others.map((p) => (
          <li key={p.id} className="flex h-16 items-center justify-between border-t border-line last:border-b">
            <span className="display text-[24px]">{p.name}</span>
            {p.is_bot && <span className="label">Bot</span>}
          </li>
        ))}
      </ul>
      <button className="slab mt-5" onClick={onDone}>Got it</button>
    </main>
  );
}
