import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center px-6">
      <div
        className="text-[8rem] font-semibold leading-none tracking-[-0.04em]"
        style={{ color: "var(--gdim)" }}
      >
        404
      </div>
      <h1
        className="text-3xl font-medium tracking-[-0.02em] mb-4"
        style={{ color: "var(--w)" }}
      >
        Page introuvable
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--w2)" }}>
        La page que vous cherchez n'existe pas.
      </p>
      <Link
        href="/"
        className="bg-[var(--gold)] text-[#09090a] font-semibold px-6 py-3 rounded-[10px] text-sm hover:bg-[var(--gold2)] transition-colors no-underline"
      >
        Retour à l'accueil
      </Link>
    </main>
  );
}
