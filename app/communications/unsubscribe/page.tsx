import Link from "next/link";

export default async function CommunicationsUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <main className="communications-system-page">
      <section>
        <p>FIRST LISTEN</p>
        <h1>Cancelar correos</h1>
        <p>
          Confirma si ya no deseas recibir resúmenes de música ni recordatorios de comunidad.
          Los avisos dentro de FirstListen se pueden controlar por separado desde tu cuenta.
        </p>
        {token ? (
          <form action="/api/communications/unsubscribe" method="post">
            <input name="token" type="hidden" value={token} />
            <input name="redirect" type="hidden" value="1" />
            <button type="submit">Cancelar correos</button>
          </form>
        ) : (
          <p className="communications-system-error">Este enlace no es válido.</p>
        )}
        <Link href="/guest">Volver a FirstListen</Link>
      </section>
    </main>
  );
}
