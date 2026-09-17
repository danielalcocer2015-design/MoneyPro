# MoneyPro — Control financiero personal

App de control financiero (gastos e ingresos, categorías, análisis) con un
diferenciador clave: un **atajo de iPhone o Android que registra un gasto
sin necesidad de abrir la app**, tocando un botón en la pantalla de inicio
o usando el asistente de voz.

Sitio estático (HTML/CSS/JS, sin build step) + Firebase (Authentication,
Firestore y una Cloud Function que expone el webhook del atajo).

## Funciones

- **Inicio**: balance del mes, ingresos y gastos, movimientos recientes.
- **Movimientos**: historial completo con filtros por mes y tipo, alta/edición/borrado.
- **Análisis**: gráfica de gastos por categoría (mes seleccionable) y comparativa
  de ingresos vs. gastos de los últimos 6 meses.
- **Ajustes**: cuenta, moneda (MXN/USD/EUR), tema claro/oscuro, y la
  configuración del atajo (URL + token, instrucciones paso a paso para
  iPhone y Android).
- **Modo demostración**: explora la app con datos de ejemplo sin crear cuenta
  (guardado solo en este navegador; el atajo no está disponible en este modo).
- **Atajo de iPhone/Android**: cada cuenta tiene un token privado y una URL
  webhook (`/api/add?token=...&amount=...&category=...`) para registrar un
  gasto desde la app Atajos de Apple, Siri, un widget, o la app "HTTP
  Shortcuts" en Android — sin abrir MoneyPro.

## Cómo funciona el atajo (webhook)

`functions/index.js` expone una Cloud Function (`api`) con dos rutas:

- `GET/POST /api/add?token=TOKEN&amount=50&category=comida&type=expense&note=Café`
  Registra un movimiento para el usuario dueño de `TOKEN`. Responde JSON
  `{ ok: true, message: "..." }`, pensado para que Atajos de iOS muestre el
  mensaje como notificación o Siri lo lea en voz alta.
- `GET /api/balance?token=TOKEN`
  Devuelve el balance del mes actual (ingresos, gastos, balance) — útil para
  preguntarle a Siri "¿cómo voy este mes?".

El `token` es un identificador aleatorio de 24 caracteres, independiente de
la contraseña de la cuenta, que se genera y regenera desde **Ajustes**. Solo
el backend (Admin SDK, `functions/index.js`) puede leer o escribir el mapa
`token → usuario` (colección `webhookTokens`); las reglas de Firestore
(`firestore.rules`) bloquean ese acceso al cliente.

## Configurar Firebase (requerido para cuentas reales y el atajo)

Sin esto, la app sigue funcionando en **modo demostración únicamente**.

1. Crea un proyecto gratuito en la [consola de Firebase](https://console.firebase.google.com)
   (plan Blaze — "pago por uso" — es necesario para desplegar Cloud Functions;
   el uso de una app personal cae dentro de la capa gratuita).
2. **Authentication** → Sign-in method → activa **Correo/contraseña**.
3. **Firestore Database** → crea la base en modo producción, cualquier región.
4. **Configuración del proyecto → Tus apps** → crea una app web y copia el
   objeto `firebaseConfig`.
5. Pégalo en `public/firebase-config.js`, reemplazando los valores `YOUR_...`.
6. Instala las herramientas de Firebase y autentícate:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add   # selecciona tu proyecto
   ```
7. Instala las dependencias de las funciones y despliega todo:
   ```bash
   cd functions && npm install && cd ..
   firebase deploy
   ```
   Esto publica Hosting (carpeta `public/`), las reglas de Firestore y la
   Cloud Function `api` (el webhook), y configura el rewrite `/api/**` para
   que apunte a la función automáticamente (ver `firebase.json`).
8. Abre la URL que te da el deploy (`https://TU-PROYECTO.web.app`), crea una
   cuenta, y en **Ajustes → Atajo** copia tu URL personal.

## Uso local (solo frontend, sin backend)

```bash
npx http-server public
# o
python3 -m http.server 8000 --directory public
```

Sin `firebase-config.js` configurado, solo está disponible el modo
demostración (perfecto para probar la interfaz).

## Configurar tu propio dominio (opcional)

Independiente del nombre del repositorio o de tu usuario de GitHub. Una vez
desplegado en Firebase Hosting:

1. Compra un dominio (ej. `misgastos.app`) en cualquier registrador.
2. En la consola de Firebase → **Hosting → Agregar dominio personalizado**,
   escribe tu dominio.
3. Agrega en tu registrador los registros DNS que te indique Firebase.
4. En unas horas tu app queda disponible en `https://tudominio.com` con
   HTTPS automático.

## Configurar el atajo

### iPhone (Atajos de Apple)

1. Abre la app **Atajos** (viene instalada de fábrica) → **+** para crear
   uno nuevo.
2. Agrega **«Preguntar por texto»** dos veces (una para el monto, otra para
   la categoría).
3. Agrega **«Obtener contenido de URL»**: pega tu URL personal (Ajustes →
   Atajo → Copiar URL), método **POST**, y agrega `amount` y `category` como
   parámetros de solicitud usando el texto de los pasos anteriores.
4. Guarda el atajo, agrégalo a tu pantalla de inicio, al Botón de Acción, o
   invócalo con Siri ("Oye Siri, agregar gasto").

### Android (HTTP Shortcuts)

1. Instala **HTTP Shortcuts** (Waboodoo) desde Play Store o F-Droid.
2. Crea un atajo nuevo: método **POST**, pega tu URL personal.
3. En "Parámetros de solicitud" agrega `amount` y `category` como variables
   marcadas "Preguntar al ejecutar".
4. Colócalo como widget en tu pantalla de inicio o accesos directos del
   ícono de la app.

Categorías válidas — gastos: `comida`, `transporte`, `vivienda`, `ocio`,
`salud`, `servicios`, `compras`, `otros`. Ingresos (con `type=income`):
`salario`, `freelance`, `inversion`, `regalo`, `otros_ingresos`.

## Estructura

```
public/
  index.html          markup de la SPA
  style.css            tema oscuro/claro vía variables CSS
  app.js               lógica de la app (auth, Firestore, modo demo)
  categories.js         categorías fijas de gasto/ingreso
  charts.js             donut y barras dibujados a mano (SVG/HTML)
  firebase-config.js    config de Firebase (placeholder hasta configurarlo)
  manifest.json / sw.js  PWA instalable
functions/
  index.js              webhook /api/add, /api/balance, regenerateToken
firestore.rules          reglas de seguridad (dueño de sus datos; webhookTokens solo backend)
firebase.json             Hosting + rewrite /api/** → Cloud Function
```
