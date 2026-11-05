# Firma y paquete Android de First Listen

## Identidad fija

- Aplicación: `First Listen`
- Package ID: `net.firstlisten.app`
- Version code inicial: `1`
- Version name inicial: `1`
- Minimum SDK: `24` (Android 7.0)
- Target SDK: `36`
- Inicio: `https://www.firstlisten.net/guest?source=android-app`
- Audiencia Android: solamente `18 and over`

El Package ID no debe cambiar después de registrar la aplicación en Play
Console. Cada actualización futura debe aumentar `versionCode`.

## Firma

La clave privada de subida se guarda fuera del repositorio en:

`Documents/FirstListen-Android-Signing-Backup`

La contraseña no se guarda en texto. Está cifrada mediante Windows DPAPI y solo
la cuenta de Windows que la creó puede descifrarla. GitHub contiene únicamente
el proyecto Android y nunca la clave, el archivo DPAPI o una contraseña.

Google Play debe administrar la clave final mediante **Play App Signing**. La
clave local es solamente la upload key utilizada para firmar cada AAB antes de
subirlo. Después de crear la aplicación en Play Console, la huella de la clave de
firma de Google también debe agregarse a Digital Asset Links; no se debe
reemplazar la huella de desarrollo hasta terminar las pruebas locales.

## Crear el AAB

Desde la raíz del proyecto:

`npm run play-store:block4:build`

El comando descifra la contraseña únicamente en memoria, genera un AAB y un APK
firmados y copia los resultados a `artifacts/android`. Los binarios están
ignorados por Git.

Después ejecutar:

`npm run play-store:block4:verify:artifact`

El primer AAB firmado y verificado mide `1,117,056` bytes y su SHA-256 es:

`BB3C2AC1E92FAEA5049EEF153117FFCC528F5A8B54A5F96155DC783E1F784E83`

El análisis final confirmó cero permisos de cámara, micrófono, ubicación y
notificaciones. El APK de prueba quedó firmado con los esquemas v2 y v3.

## Respaldo obligatorio

La carpeta privada local evita que la clave llegue a GitHub, pero no protege
contra pérdida del disco. Antes de la primera subida a Play Console, copiar la
carpeta completa a una memoria USB guardada de forma segura o a un almacenamiento
privado cifrado. No enviar sus archivos por correo, WhatsApp ni mensajería.

## Primera subida a Play Console

1. Crear la aplicación con Package ID `net.firstlisten.app`.
2. Seleccionar únicamente audiencia `18 and over`.
3. Crear una prueba interna o cerrada.
4. Activar Play App Signing con la clave generada por Google.
5. Subir `First-Listen-v1.aab`.
6. Copiar la huella SHA-256 de **App signing key certificate** de Play Console.
7. Agregar esa huella a `ANDROID_SHA256_FINGERPRINTS` junto con la huella de la
   upload key y volver a verificar `/.well-known/assetlinks.json`.

No iniciar todavía el periodo de 12 probadores hasta completar la ficha, el
acceso del revisor y una prueba interna del AAB.
