import Link from "next/link";

export default async function CommunicationsUnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const invalid = status === "invalid";
  return (
    <main className="communications-system-page">
      <section>
        <p>FIRST LISTEN</p>
        <h1>{invalid ? "Enlace no válido" : "Correos desactivados"}</h1>
        <p>
          {invalid
            ? "No pudimos comprobar este enlace. Puedes cambiar tus preferencias desde tu cuenta."
            : "No recibirás más resúmenes ni recordatorios por correo. Puedes seguir usando FirstListen normalmente."}
        </p>
        <Link href="/guest">Volver a FirstListen</Link>
      </section>
    </main>
  );
}
