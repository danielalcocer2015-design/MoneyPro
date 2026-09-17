# MoneyPro — Control financiero personal

App de control financiero (gastos e ingresos, categorías, análisis) con un
diferenciador clave: un **atajo de iPhone o Android que registra un gasto
sin necesidad de abrir la app**, tocando un botón en la pantalla de inicio
o usando el asistente de voz.

Sitio estático (HTML/CSS/JS, sin build step) + Firebase (Authentication,
Firestore, y Realtime Database para el atajo). Funciona completo en el
**plan gratuito Spark** — no necesita tarjeta ni Cloud Functions.

## Funciones

- **Inicio**: balance del mes, ingresos y gastos, movimientos recientes.
- **Movimientos**: historial completo con filtros por mes y tipo, alta/edición/borrado.
- **Análisis**: gráfica de gastos por categoría (mes seleccionable) y comparativa
  de ingresos vs. gastos de los últimos 6 meses.
- **Ajustes**: cuenta, moneda (MXN/USD/EUR), tema claro/oscuro, y la
  configuración del atajo (URL + plantilla JSON + token, instrucciones paso
  a paso para iPhone y Android).
- **Modo demostración**: explora la app con datos de ejemplo sin crear cuenta
  (guardado solo en este navegador; el atajo no está disponible en este modo).
- **Atajo de iPhone/Android**: cada cuenta tiene un token privado. El atajo
  hace un POST con JSON a tu Realtime Database desde la app Atajos de Apple,
  Siri, un widget, o "HTTP Shortcuts" en Android — sin abrir MoneyPro.

## Cómo funciona el atajo (sin Cloud Functions)

El atajo no puede iniciar sesión, así que no escribe directo en Firestore.
En su lugar:

1. El atajo hace `POST` con JSON plano a tu Realtime Database:
   `https://TU_PROYECTO-default-rtdb.firebaseio.com/txInbox/TU_UID.json`
   con cuerpo `{ "amount": 50, "type": "expense", "category": "comida", "note": "", "token": "...", "ts": {".sv": "timestamp"} }`.
2. `database.rules.json` valida que el campo `token` coincida con el token
   guardado en `userTokens/TU_UID` antes de aceptar la escritura — así nadie
   más puede escribir en tu buzón sin conocer tu token.
3. La próxima vez que abres sesión en la app, `drainInbox()` (en `public/app.js`)
   copia automáticamente lo que haya en tu buzón a tus movimientos normales
   de Firestore, y limpia el buzón. Por eso un gasto agregado por atajo
   aparece en Inicio/Análisis la próxima vez que abras MoneyPro, no al
   instante — pero queda guardado desde el segundo en que tocas el atajo.

El token (24 caracteres, aleatorio) se genera y regenera desde **Ajustes**,
y solo tú puedes leerlo o cambiarlo (`database.rules.json` lo protege por
`uid`).

> **¿Prefieres un webhook con URL simple (`/api/add?amount=...`) y que el
> gasto aparezca al instante sin abrir la app?** Eso requiere Cloud
> Functions, que a su vez requiere el plan Blaze (sigue siendo gratis en la
> práctica, solo pide tarjeta de verificación). El código ya existe en
> `functions/index.js` — ver la sección **Actualizar a Blaze** más abajo.

## Configurar Firebase (plan Spark, gratis)

Sin esto, la app sigue funcionando en **modo demostración únicamente**.

1. Crea un proyecto gratuito en la [consola de Firebase](https://console.firebase.google.com).
2. **Authentication** → Sign-in method → activa **Correo/contraseña**.
3. **Firestore Database** → crea la base en modo producción, cualquier región.
4. **Realtime Database** → **Crear base de datos** → modo **bloqueado**
   (las reglas de `database.rules.json` las publicas en el paso 7).
5. **Configuración del proyecto → Tus apps** → crea una app web y copia el
   objeto `firebaseConfig` (debe incluir `databaseURL`; si no aparece,
   cópialo de la pantalla de Realtime Database, algo como
   `https://TU_PROYECTO-default-rtdb.firebaseio.com`).
6. Pégalo en `public/firebase-config.js`, reemplazando los valores `YOUR_...`.
7. Instala las herramientas de Firebase, autentícate, y despliega:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add   # selecciona tu proyecto
   firebase deploy --only hosting,firestore:rules,database
   ```
8. Abre la URL que te da el deploy (`https://TU-PROYECTO.web.app`), crea una
   cuenta, y en **Ajustes → Atajo** copia tu URL y tu plantilla JSON.

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

En **Ajustes → ⚡ Atajo**, primero copia tu **URL** y tu **plantilla JSON**
(dos botones). La plantilla se ve así:

```json
{
  "amount": 0,
  "type": "expense",
  "category": "comida",
  "note": "",
  "token": "tu-token-real-aquí",
  "ts": {".sv": "timestamp"}
}
```

Solo edita `amount` (el número `0`) y `category` (el texto `comida`, sin
tocar las comillas) — todo lo demás se queda igual.

### iPhone (Atajos de Apple)

1. Abre la app **Atajos** → **+** para crear uno nuevo.
2. Agrega **«Preguntar por texto»** dos veces (monto y categoría).
3. Agrega **«Obtener contenido de URL»**: pega tu URL, método **POST**,
   cuerpo de la solicitud tipo **JSON**, pega la plantilla.
4. En la plantilla pegada: borra el `0` de `"amount"` e inserta ahí (sin
   comillas) la variable del monto; borra `comida` (dejando las comillas)
   e inserta ahí la variable de categoría.
5. Guarda el atajo y agrégalo a tu pantalla de inicio, al Botón de Acción,
   o invócalo con Siri.

### Android (HTTP Shortcuts)

1. Instala **HTTP Shortcuts** (Waboodoo) desde Play Store o F-Droid.
2. Crea un atajo: método **POST**, pega tu URL, cuerpo tipo **JSON personalizado**,
   pega la plantilla.
3. Reemplaza `0` y `comida` por variables (Insertar → Variable → Preguntar
   al ejecutar).
4. Colócalo como widget en tu pantalla de inicio.

Categorías válidas — gastos: `comida`, `transporte`, `vivienda`, `ocio`,
`salud`, `servicios`, `compras`, `otros`. Ingresos (con `"type": "income"`):
`salario`, `freelance`, `inversion`, `regalo`, `otros_ingresos`.

## Actualizar a Blaze más adelante (opcional)

Si luego quieres que el gasto aparezca al instante (sin esperar a abrir la
app) y una URL más simple con parámetros (`/api/add?amount=...&category=...`),
sube tu proyecto al plan Blaze y restaura las Cloud Functions:

1. En la consola: **Uso y facturación → Modificar plan → Blaze**.
2. En `firebase.json`, agrega de nuevo:
   ```json
   "functions": [{ "source": "functions", "codebase": "default" }]
   ```
   y en `hosting.rewrites`, antes del catch-all `"**"`:
   ```json
   { "source": "/api/**", "function": "api" }
   ```
3. `cd functions && npm install && cd .. && firebase deploy --only functions,hosting`

El código de `functions/index.js` (webhook `/api/add`, `/api/balance`, y
`regenerateToken`) ya está listo, solo estaba desconectado por defecto.

## Estructura

```
public/
  index.html            markup de la SPA
  style.css              tema oscuro/claro vía variables CSS
  app.js                 lógica de la app (auth, Firestore, Realtime DB, modo demo)
  categories.js           categorías fijas de gasto/ingreso
  charts.js               donut y barras dibujados a mano (SVG/HTML)
  firebase-config.js      config de Firebase (placeholder hasta configurarlo)
  manifest.json / sw.js    PWA instalable
functions/
  index.js                webhook opcional /api/add, /api/balance (requiere Blaze, ver arriba)
firestore.rules            reglas de seguridad de Firestore (dueño de sus datos)
database.rules.json        reglas de Realtime Database (buzón del atajo, protegido por token)
firebase.json               Hosting + Firestore + Realtime Database
```
