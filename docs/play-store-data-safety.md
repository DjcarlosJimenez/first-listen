# First Listen: declaraciones para Google Play

Este documento convierte el funcionamiento real de First Listen en respuestas
preparadas para Play Console. No contiene contraseñas ni claves. Debe revisarse
otra vez si se agrega publicidad, pagos, notificaciones, otro proveedor de
analítica o un SDK nativo.

## Estado del bloque 3

- Inventario técnico: completo el 4 de noviembre de 2026.
- Política de privacidad: alineada con web, PWA y futura aplicación Android.
- Data safety: borrador completo y verificable.
- Anuncios: **No**.
- Acceso de revisores: instrucciones preparadas; falta crear una cuenta de
  revisión cuando exista el AAB.
- Audiencia: confirmada por el propietario el 4 de noviembre de 2026 para
  personas de 18 años o más.

La versión estructurada está en
`android/play-console-declarations.json`.

## Respuestas principales

### Política de privacidad

- URL pública: `https://www.firstlisten.net/privacy`
- Eliminación de cuenta: `https://www.firstlisten.net/delete-account`
- La misma política cubre web, PWA y Android.

### Anuncios

Responder **No** a “Does your app contain ads?”. El proyecto no contiene una red
de anuncios, AdMob ni un SDK publicitario. Si esto cambia, esta respuesta debe
cambiar antes de publicar la nueva versión.

### Acceso a la aplicación

La reproducción y exploración principal funcionan como visitante. También hay
funciones que requieren cuenta: perfil, publicaciones, guardados y herramientas
de administración. Antes de enviar a revisión se debe crear una cuenta estable
para Google Play con estas condiciones:

1. correo exclusivo para revisión;
2. contraseña estable y guardada solamente en Play Console y en el administrador
   de contraseñas del propietario;
3. sin código temporal, sin verificación en dos pasos y sin restricción por país;
4. instrucciones en inglés para abrir la aplicación, iniciar sesión y llegar a
   las funciones protegidas;
5. probar la cuenta desde un teléfono que nunca haya iniciado sesión.

No se deben guardar esas credenciales en GitHub ni en este documento.

### Audiencia

Decisión confirmada para el primer lanzamiento: seleccionar solamente
**18 and over**.
First Listen no está diseñado para niños y puede mostrar música enviada por
usuarios con lenguaje explícito o temas maduros. Esta selección reduce el riesgo
de declarar la aplicación como dirigida a menores y de entrar por error en el
programa Families.

### Clasificación de contenido

Responder el cuestionario de IARC según lo que realmente puede aparecer:

- contenido generado o enviado por usuarios: **Sí**;
- música con lenguaje explícito o temas maduros: **Sí, puede aparecer**;
- moderación, reporte y bloqueo: **Sí**;
- apuestas o juegos de azar: **No**;
- compras o premios con dinero real: **No**;
- venta de reproducciones o recompensas por escuchar: **No**.

No se debe adivinar una clasificación final; Play Console la calcula después de
contestar el cuestionario.

## Data safety

Responder **Sí** a que la aplicación recopila datos. Responder **No** a que vende
datos. El borrador actual responde **No** a “data shared” porque Supabase, Vercel
y Resend actúan como proveedores del servicio, y los reproductores externos se
abren o reproducen por decisión del usuario. Esta respuesta debe auditarse de
nuevo si se integra un SDK de anuncios, atribución, redes sociales o analítica.

| Categoría de Play | Dato | Recopilado | Compartido | Opcional | Uso principal |
| --- | --- | --- | --- | --- | --- |
| Personal info | Name | Sí | No | Sí | perfil y cuenta |
| Personal info | Email address | Sí | No | Sí | acceso, recuperación y correo transaccional |
| Personal info | User IDs | Sí | No | Sí | cuenta, seguridad y analítica |
| Photos and videos | Photos | Sí | No | Sí | avatares, portadas e identidad de artista |
| Audio files | Music and audio files | Sí | No | Sí | adelantos cortos administrados por artistas |
| App activity | App interactions | Sí | No | No | reproductor, rotación, seguridad y analítica |
| App activity | Other user-generated content | Sí | No | Sí | publicaciones, reseñas, comentarios y reportes |
| App activity | Other actions | Sí | No | Sí | guardados, seguidores, decisiones y reportes |
| Device or other IDs | Device or other IDs | Sí | No | No | identificadores aleatorios y hashes contra abuso |

Todos los datos viajan mediante HTTPS. First Listen no usa identificador de
publicidad. No recopila ubicación precisa, información financiera, salud,
contactos ni calendario. Una IP puede procesarse temporalmente para seguridad y
guardarse únicamente como hash; First Listen no deriva ubicación de esa IP.

## Comprobación antes de enviar a revisión

1. Ejecutar `npm run play-store:block3:verify`.
2. Confirmar que Play Console muestre únicamente `18 and over`.
3. Crear la cuenta de revisor sin guardar credenciales en el repositorio.
4. Comparar cada respuesta de Play Console con
   `android/play-console-declarations.json`.
5. Ejecutar la comprobación de producción después del despliegue.
6. Volver a auditar si el AAB agrega permisos o SDK nuevos.

## Fuentes oficiales

- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- App access: https://support.google.com/googleplay/android-developer/answer/15748846
- Target audience: https://support.google.com/googleplay/android-developer/answer/9867159
- Prepare for review: https://support.google.com/googleplay/android-developer/answer/9859455
- Account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Content ratings: https://support.google.com/googleplay/android-developer/answer/9859655
