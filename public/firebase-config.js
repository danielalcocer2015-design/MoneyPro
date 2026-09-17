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
  apiKey: "AIzaSyDDHjFHGdDcrePHZzON417DWNcvus1BaGo",
  authDomain: "moneypro-9dbfb.firebaseapp.com",
  projectId: "moneypro-9dbfb",
  storageBucket: "moneypro-9dbfb.firebasestorage.app",
  messagingSenderId: "222242221709",
  appId: "1:222242221709:web:4ded5a7202dd49e23b3cc4",
  measurementId: "G-352S7Z1PTL",
  // Verifica esta URL contra la que muestra la consola de Realtime
  // Database al crearla (puede variar según la región elegida).
  databaseURL: "https://moneypro-9dbfb-default-rtdb.firebaseio.com",
};

export const firebaseEnabled = firebaseConfig.apiKey !== "YOUR_API_KEY" && !!firebaseConfig.apiKey;
