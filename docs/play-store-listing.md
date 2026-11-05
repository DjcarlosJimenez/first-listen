# First Listen: ficha de Google Play

Este paquete deja preparado el bloque 5. Los textos estructurados se encuentran
en `android/play-store/listing.json` y los archivos visuales en
`android/play-store/assets/`.

## Campos de la ficha

- Nombre: **First Listen**
- Categoría: **Music & Audio**
- Idioma predeterminado: **Spanish (United States)**
- Correo de soporte: `support@firstlisten.net`
- Sitio web: `https://www.firstlisten.net/help`
- Política de privacidad: `https://www.firstlisten.net/privacy`
- Eliminación de cuenta: `https://www.firstlisten.net/delete-account`
- Contiene anuncios: **No**

Los textos en español e inglés cumplen los límites de Google Play: nombre de
30 caracteres, descripción breve de 80 y descripción completa de 4,000.

## Audiencia y acceso de menores

En **Target audience and content** seleccionar solamente **18 and over**. Además,
activar **Restrict Minor Access** para impedir que cuentas identificadas como
menores busquen, descarguen o compren la aplicación. First Listen no está
diseñado para niños y puede mostrar música con lenguaje explícito o temas
maduros.

## Clasificación IARC

El cuestionario debe contestarse según la experiencia real:

- contenido generado o enviado por usuarios: **Sí**;
- música con lenguaje explícito o temas maduros: **Sí, puede aparecer**;
- interacción entre usuarios: **Sí**, cuando se habiliten perfiles o actividad;
- reporte, bloqueo y moderación: **Sí**;
- apuestas o juegos de azar: **No**;
- compras, premios o recompensas con dinero real: **No**;
- venta de reproducciones o recompensas por reproducir: **No**.

Play Console calcula la clasificación final. No debe seleccionarse una
clasificación manualmente ni minimizar contenido explícito posible.

## Material visual

- Icono: PNG de 512 x 512.
- Gráfico destacado: JPG de 1024 x 500, sin texto promocional, precios ni
  insignias de tienda.
- Capturas: cuatro imágenes JPG de teléfono de 1080 x 1920 tomadas de la
  experiencia real de First Listen.

Para regenerar y comprobar el paquete:

```text
npm run play-store:block5:assets
npm run play-store:block5:capture -- --base-url=https://www.firstlisten.net
npm run play-store:block5:verify
```

## Antes de enviar a revisión

1. Cargar el AAB firmado del bloque 4.
2. Activar Play App Signing.
3. Copiar la huella SHA-256 que Google genere a la asociación del dominio.
4. Completar Data safety con `android/play-console-declarations.json`.
5. Crear una cuenta estable para el revisor y guardar sus credenciales solamente
   en Play Console y en el administrador de contraseñas del propietario.
6. Verificar desde un teléfono que nunca haya iniciado sesión.

## Fuentes oficiales

- Store listing: https://support.google.com/googleplay/android-developer/answer/9859152
- Preview assets: https://support.google.com/googleplay/android-developer/answer/9866151
- Target audience: https://support.google.com/googleplay/android-developer/answer/9867159
- Content ratings: https://support.google.com/googleplay/android-developer/answer/9898843
