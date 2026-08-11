import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBC8RjBG7MlylhEMAhgpBbKbTpS_yKdNWI",
  authDomain: "churang-b2d09.firebaseapp.com",
  projectId: "churang-b2d09",
  storageBucket: "churang-b2d09.firebasestorage.app",
  messagingSenderId: "698888226870",
  appId: "1:698888226870:web:8d55418255eee8f97b7097",
  measurementId: "G-78216V6HNE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
