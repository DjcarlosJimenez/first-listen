# First Listen: ruta hacia Google Play

Esta ruta mantiene una sola experiencia de First Listen en web y Android. La
aplicación Android se preparará como una Trusted Web Activity asociada al dominio
oficial, no como una copia desconectada ni como un contenedor de contenido ajeno.

## Estado de los siete bloques

1. **Seguridad y cumplimiento básico — completo.** Eliminación de cuenta dentro y
   fuera de la aplicación, reportes, bloqueos, moderación y reproducción orgánica
   sin recompensas por escuchar.
2. **Base Android y asociación del dominio — preparada.** Identidad candidata
   `net.firstlisten.app`, Android 16/API 36, inicio en la experiencia sencilla,
   endpoint de Digital Asset Links y comprobación automática. La asociación se
   completará cuando exista la clave de firma definitiva.
3. **Inventario de datos y declaraciones — preparado.** Data safety, anuncios,
   acceso de revisores, permisos y contenido ya están documentados y se pueden
   verificar automáticamente. Falta que el propietario confirme la audiencia
   inicial antes de copiar las respuestas a Play Console.
4. **Paquete firmado — pendiente.** Generar el proyecto Android, crear y respaldar
   la clave, activar Play App Signing y producir el archivo AAB.
5. **Ficha de Play Store — pendiente.** Nombre, descripción, icono, banner,
   capturas reales de teléfono y clasificación de contenido.
6. **Pruebas cerradas — pendiente.** Subir el AAB y ejecutar el periodo de prueba
   que corresponda a la cuenta de desarrollador.
7. **Revisión y lanzamiento — pendiente.** Corregir el informe previo, enviar a
   revisión, publicar gradualmente y vigilar errores y abandonos.

## Base técnica del bloque 2

- Aplicación: `First Listen`
- Identidad Android candidata: `net.firstlisten.app`
- Dominio verificado previsto: `https://www.firstlisten.net`
- Inicio Android: `https://www.firstlisten.net/guest?source=android-app`
- SDK mínimo: 23
- SDK objetivo: 36
- Asociación: `https://www.firstlisten.net/.well-known/assetlinks.json`

La identidad es todavía reversible porque no se ha subido ningún AAB a Play
Console. La asociación quedará activa cuando exista la clave de firma definitiva
y su huella SHA-256 se guarde como `ANDROID_SHA256_FINGERPRINTS` en producción.

## Fuentes oficiales consultadas

- Target API: https://developer.android.com/google/play/requirements/target-sdk
- Trusted Web Activities: https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities
- Digital Asset Links y Bubblewrap: https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2
- Calidad y funcionalidad: https://support.google.com/googleplay/android-developer/answer/18265346
- Pruebas para cuentas personales nuevas: https://support.google.com/googleplay/android-developer/answer/14151465
