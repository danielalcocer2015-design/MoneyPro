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
- **Categorías personalizadas**: agrega, renombra o borra tus propias
  categorías y subcategorías (Ajustes → Categorías) — no vienen fijas en el
  código, cada cuenta tiene las suyas.
- **Ajustes**: cuenta, moneda (MXN/USD/EUR), tema claro/oscuro, categorías,
  y la configuración del atajo (URLs + plantilla JSON + token, instrucciones
  paso a paso para iPhone y Android).
- **Modo demostración**: explora la app con datos de ejemplo sin crear cuenta
  (guardado solo en este navegador; el atajo no está disponible en este modo).
- **Atajo de iPhone/Android**: cada cuenta tiene un token privado. El atajo
  primero consulta tus categorías en vivo (GET) y luego hace un POST con
  JSON a tu Realtime Database — desde Atajos de Apple, Siri, un widget, o
  "HTTP Shortcuts" en Android — sin abrir MoneyPro.

## Cómo funciona el atajo (sin Cloud Functions)

El atajo no puede iniciar sesión, así que no escribe directo en Firestore.
En su lugar:

1. El atajo hace `POST` con JSON plano a tu Realtime Database:
   `https://TU_PROYECTO-default-rtdb.firebaseio.com/txInbox/TU_TOKEN.json`
   con cuerpo `{ "amount": 50, "type": "expense", "category": "comida", "note": "", "ts": {".sv": "timestamp"} }`.
   El **token es la URL misma** — no hace falta mandarlo también en el
   cuerpo, ni tu uid: solo quien conoce tu token puede escribir ahí
   (`database.rules.json` no permite listar ni adivinar tokens ajenos).
   Esto hace que compartir el atajo con otra persona sea mucho más simple:
   solo tiene un valor personal que reemplazar en todo el atajo (su token),
   no dos (token + uid).
2. La próxima vez que abres sesión en la app, `drainInbox()` (en `public/app.js`)
   copia automáticamente lo que haya en tu buzón a tus movimientos normales
   de Firestore, y limpia el buzón. Por eso un gasto agregado por atajo
   aparece en Inicio/Análisis la próxima vez que abras MoneyPro, no al
   instante — pero queda guardado desde el segundo en que tocas el atajo.

El token (24 caracteres, aleatorio) se genera y regenera desde **Ajustes**,
y solo tú puedes leerlo o cambiarlo (`database.rules.json` lo protege por
`uid`).

Las categorías viven en Firestore (`users/{uid}/meta/categories`, editables
desde Ajustes → Categorías) y se copian — solo los nombres, gateados por el
mismo token — a `catList/TU_TOKEN` en Realtime Database cada vez que
cambian. El atajo hace un `GET` a esa ruta antes de mostrar el menú de
categorías, así siempre ve la lista actual sin que tengas que editar el
atajo cuando agregas una nueva.

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

En **Ajustes → ⚡ Atajo** hay tres botones: **1. Copiar URL de categorías**
(GET, para el menú en vivo), **2. Copiar URL para guardar** (POST, guarda el
gasto), y **3. Copiar cuerpo JSON** (la plantilla del paso 2). Además,
**"📋 Copiar token"** copia tu token completo — úsalo siempre con ese botón,
nunca lo escribas a mano (un solo carácter distinto y falla sin avisar por
qué).

```json
{
  "amount": 0,
  "type": "expense",
  "category": "comida",
  "note": "",
  "ts": {".sv": "timestamp"}
}
```

Solo edita `amount` (el número `0`) y `category` (el texto `comida`, sin
tocar las comillas) — `type` normalmente también se vuelve dinámico (ver
paso 2 más abajo, pregunta Gasto/Ingreso) — todo lo demás se queda igual.

### iPhone (Atajos de Apple)

Para que compartir el atajo con alguien más sea tan simple como pegar un
solo valor, arma primero un campo con tu token y reutilízalo en todo lo
demás:

1. Abre **Atajos** → **+** para crear uno nuevo.
2. Agrega **«Texto»**: pega tu token (botón «Copiar token»). Este va a ser
   el único campo que alguien más tenga que cambiar si le compartes el atajo.
3. (Opcional pero recomendado) Agrega **«Lista»** con dos elementos: `Gasto`
   e `Ingreso`. Justo después, **«Seleccionar de la lista»** con mensaje
   «¿Gasto o ingreso?». Luego dos **«Reemplazar texto»** encadenadas:
   `Gasto`→`expense` (en el elemento elegido), y `Ingreso`→`income` (en el
   resultado de la anterior) — el resultado final es tu variable "Tipo".
   Si te lo saltas, usa `expense` fijo en el paso 5.
4. Agrega **«Texto»**: arma la URL de categorías combinando texto y
   variables: `https://TU_PROYECTO-default-rtdb.firebaseio.com/catList/` +
   [tu Texto del paso 2] + `/` + [tu "Tipo" del paso 3, o escribe `expense`
   si te saltaste ese paso] + `.json`.
5. Agrega **«Obtener contenido de URL»** con la URL del paso 4 (GET, sin
   tocar método ni cuerpo).
6. Agrega **«Elegir de la lista»**: en el campo Lista, usa la variable
   «Contenido de URL» del paso 5.
7. Agrega **«Preguntar por texto»** (o «Solicitar número») para el monto.
8. Agrega otro **«Texto»**: `https://TU_PROYECTO-default-rtdb.firebaseio.com/txInbox/`
   + [tu Texto del paso 2] + `.json` — esta es la URL de guardar.
9. Agrega **«Obtener contenido de URL»** con la URL del paso 8, método
   **POST**, cuerpo tipo **JSON**, con los campos `amount` (tipo Número,
   variable del monto), `type` (tu "Tipo" del paso 3, o `expense` fijo) y
   `category` (variable «Elemento elegido» del paso 6). **No** agregues un
   campo `token` — ya no hace falta, va en la URL.
10. Guarda el atajo y agrégalo a tu pantalla de inicio, al Botón de Acción,
    o invócalo con Siri.

Para compartirlo: ••• → **Compartir** → **Copiar enlace de iCloud**. Quien
lo reciba solo edita el **Texto del paso 2** con su propio token (después
de crear su cuenta en la app y copiarlo desde Ajustes) — todo lo demás
funciona igual, sin tocar nada más.

### Android (HTTP Shortcuts)

1. Instala **HTTP Shortcuts** (Waboodoo) desde Play Store o F-Droid.
2. Si tu versión permite variables tipo Selección con opciones cargadas
   desde una petición HTTP, apúntala a la URL del botón 1 (GET). Si no,
   escribe las opciones a mano — deben coincidir con tus categorías
   actuales (revísalas en Ajustes → Categorías).
3. Crea el atajo: método **POST**, URL del botón 2, cuerpo tipo **JSON
   personalizado**, pega la plantilla del botón 3.
4. Reemplaza `0` por tu variable Número, y `comida` por tu variable Selección.
5. Colócalo como widget en tu pantalla de inicio.

Las categorías son las que tú definas en Ajustes → Categorías (no vienen
fijas) — el respaldo si algo no coincide es siempre "Otros" / "Otros ingresos".

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
  categories.js           categorías por defecto (semilla) + helpers
  charts.js               donut y barras dibujados a mano (SVG/HTML)
  firebase-config.js      config de Firebase (placeholder hasta configurarlo)
  manifest.json / sw.js    PWA instalable
functions/
  index.js                webhook opcional /api/add, /api/balance (requiere Blaze, ver arriba)
firestore.rules            reglas de seguridad de Firestore (dueño de sus datos)
database.rules.json        reglas de Realtime Database (buzón del atajo, protegido por token)
firebase.json               Hosting + Firestore + Realtime Database
```
