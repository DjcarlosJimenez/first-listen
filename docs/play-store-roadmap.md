# First Listen: ruta hacia Google Play

Esta ruta mantiene una sola experiencia de First Listen en web y Android. La
aplicación Android se preparará como una Trusted Web Activity asociada al dominio
oficial, no como una copia desconectada ni como un contenedor de contenido ajeno.

## Estado de los siete bloques

1. **Seguridad y cumplimiento básico — completo.** Eliminación de cuenta dentro y
   fuera de la aplicación, reportes, bloqueos, moderación y reproducción orgánica
   sin recompensas por escuchar.
2. **Base Android y asociación del dominio — completa para la clave de subida.** Identidad
   `net.firstlisten.app`, Android 16/API 36, inicio en la experiencia sencilla,
   endpoint de Digital Asset Links y comprobación automática. La huella de la
   clave final de Google se agregará después de activar Play App Signing.
3. **Inventario de datos y declaraciones — completo.** Data safety, anuncios,
   acceso de revisores, permisos y contenido están documentados. La audiencia
   Android está confirmada únicamente para personas de 18 años o más.
4. **Paquete firmado — completo.** AAB versión 1 generado con API 36, firmado y
   verificado; APK de prueba firmado; clave privada protegida fuera de GitHub y
   proceso reproducible. Play App Signing se activará al subir el AAB por primera vez.
5. **Ficha de Play Store — preparada para cargar.** Nombre y descripciones en
   español e inglés, icono, banner 1024 x 500, cuatro capturas reales de
   teléfono, categoría, contacto, audiencia 18+ y guía de clasificación. Falta
   introducir estos datos en Play Console cuando se abra la ficha de la app.
6. **Pruebas cerradas — pendiente.** Subir el AAB y ejecutar el periodo de prueba
   que corresponda a la cuenta de desarrollador.
7. **Revisión y lanzamiento — pendiente.** Corregir el informe previo, enviar a
   revisión, publicar gradualmente y vigilar errores y abandonos.

## Base técnica del bloque 2

- Aplicación: `First Listen`
- Identidad Android candidata: `net.firstlisten.app`
- Dominio verificado previsto: `https://www.firstlisten.net`
- Inicio Android: `https://www.firstlisten.net/guest?source=android-app`
- SDK mínimo: 24 (Android 7.0)
- SDK objetivo: 36
- Asociación: `https://www.firstlisten.net/.well-known/assetlinks.json`

La identidad es todavía reversible porque no se ha subido ningún AAB a Play
Console. La asociación con la clave de subida ya está configurada. Cuando Google
genere la clave definitiva de Play App Signing, su huella SHA-256 se agregará a
`ANDROID_SHA256_FINGERPRINTS` sin retirar la huella de subida.

## Fuentes oficiales consultadas

- Target API: https://developer.android.com/google/play/requirements/target-sdk
- Trusted Web Activities: https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities
- Digital Asset Links y Bubblewrap: https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2
- Calidad y funcionalidad: https://support.google.com/googleplay/android-developer/answer/18265346
- Pruebas para cuentas personales nuevas: https://support.google.com/googleplay/android-developer/answer/14151465
