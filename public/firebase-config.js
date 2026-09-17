// Config de Firebase para MoneyPro (auth + guardado en la nube + el
// webhook de atajos). Sin esto la app sigue funcionando en modo
// demostración (datos solo en este navegador, atajo desactivado).
//
// 1. Crea un proyecto gratuito en https://console.firebase.google.com
// 2. Activa Authentication → método "Correo/contraseña"
// 3. Activa Firestore Database (modo producción)
// 4. En Configuración del proyecto → Tus apps, crea una app web y copia
//    aquí el objeto firebaseConfig
// 5. Publica firestore.rules y despliega functions/ (ver README.md)
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// URL base de la Cloud Function del webhook. En Firebase Hosting con el
// rewrite de firebase.json esto es simplemente "/api"; si despliegas el
// frontend en otro lugar, usa la URL completa de la función, ej:
// "https://us-central1-YOUR_PROJECT.cloudfunctions.net/api"
export const webhookBaseUrl = "/api";

export const firebaseEnabled = firebaseConfig.apiKey !== "YOUR_API_KEY" && !!firebaseConfig.apiKey;
