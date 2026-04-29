import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center px-6">
      <div
        className="text-[8rem] font-semibold leading-none tracking-[-0.04em]"
        style={{ color: "rgba(201,162,64,0.15)" }}
      >
        404
      </div>
      <h1
        className="text-3xl font-medium tracking-[-0.02em] mb-4"
        style={{ color: "#eeecea" }}
      >
        Page introuvable
      </h1>
      <p className="text-sm mb-8" style={{ color: "rgba(238,236,234,0.52)" }}>
        La page que vous cherchez n'existe pas.
      </p>
      <Link
        href="/"
        className="bg-[#c9a240] text-[#09090a] font-semibold px-6 py-3 rounded-[10px] text-sm hover:bg-[#dcb84e] transition-colors no-underline"
      >
        Retour à l'accueil
      </Link>
    </main>
  );
}
