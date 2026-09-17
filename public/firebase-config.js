// Config de Firebase para MoneyPro (auth + guardado en la nube + el
// atajo). Sin esto la app sigue funcionando en modo demostración (datos
// solo en este navegador, atajo desactivado).
//
// 1. Crea un proyecto gratuito en https://console.firebase.google.com
//    (plan Spark alcanza — no necesitas Cloud Functions para el atajo)
// 2. Activa Authentication → método "Correo/contraseña"
// 3. Activa Firestore Database (modo producción)
// 4. Activa Realtime Database (modo bloqueado; luego publicas database.rules.json)
// 5. En Configuración del proyecto → Tus apps, crea una app web y copia
//    aquí el objeto firebaseConfig (incluye "databaseURL" una vez que
//    creaste Realtime Database — si no aparece, agrégalo a mano con la
//    URL que te muestra la sección de Realtime Database)
// 6. Publica firestore.rules y database.rules.json (ver README.md)
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
};

export const firebaseEnabled = firebaseConfig.apiKey !== "YOUR_API_KEY" && !!firebaseConfig.apiKey;
