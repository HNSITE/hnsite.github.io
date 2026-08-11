import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginButton");
const loginMessage = document.getElementById("loginMessage");
const requestPanel = document.getElementById("requestPanel");
const requestForm = document.getElementById("requestForm");
const requestButton = document.getElementById("requestButton");
const requestMessage = document.getElementById("requestMessage");

let requesting = false;

function setMessage(element, text, success = false) {
  element.textContent = text;
  element.classList.toggle("success", success);
}

async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

onAuthStateChanged(auth, async (user) => {
  if (!user || requesting) return;

  try {
    const profile = await getProfile(user.uid);
    if (profile?.status === "approved") {
      location.replace("./app.html");
      return;
    }

    await signOut(auth);
  } catch (error) {
    console.error(error);
  }
});

document.getElementById("showRequestButton").addEventListener("click", () => {
  requestPanel.classList.remove("hidden");
  document.getElementById("requestName").focus();
});

document.getElementById("cancelRequestButton").addEventListener("click", () => {
  requestPanel.classList.add("hidden");
  requestForm.reset();
  setMessage(requestMessage, "");
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(loginMessage, "");
  loginButton.disabled = true;
  loginButton.textContent = "로그인 중...";

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      document.getElementById("email").value.trim(),
      document.getElementById("password").value
    );

    const profile = await getProfile(credential.user.uid);

    if (!profile) {
      await signOut(auth);
      throw new Error("사용자 정보가 없습니다. 관리자에게 문의하세요.");
    }

    if (profile.status === "pending") {
      await signOut(auth);
      throw new Error("현재 관리자 승인 대기 중입니다.");
    }

    if (profile.status !== "approved") {
      await signOut(auth);
      throw new Error("현재 사용할 수 없는 계정입니다.");
    }

    location.replace("./app.html");
  } catch (error) {
    console.error(error);
    const knownMessage = error?.message?.includes("관리자") || error?.message?.includes("계정") || error?.message?.includes("사용자")
      ? error.message
      : "로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.";
    setMessage(loginMessage, knownMessage);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "로그인";
  }
});

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(requestMessage, "");

  const name = document.getElementById("requestName").value.trim();
  const email = document.getElementById("requestEmail").value.trim();
  const password = document.getElementById("requestPassword").value;
  const passwordConfirm = document.getElementById("requestPasswordConfirm").value;

  if (password !== passwordConfirm) {
    setMessage(requestMessage, "비밀번호와 비밀번호 확인이 일치하지 않습니다.");
    return;
  }

  requesting = true;
  requestButton.disabled = true;
  requestButton.textContent = "요청 중...";

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);

    await setDoc(doc(db, "users", credential.user.uid), {
      name,
      email,
      role: "user",
      status: "pending",
      bingoAccess: "none",
      killSheetAccess: "none",
      createdAt: serverTimestamp()
    });

    await signOut(auth);
    requestForm.reset();
    setMessage(requestMessage, "승인 요청이 완료되었습니다. 관리자의 승인을 기다려주세요.", true);
  } catch (error) {
    console.error(error);
    let text = "승인 요청에 실패했습니다.";
    if (error.code === "auth/email-already-in-use") text = "이미 등록된 이메일입니다. 로그인하거나 관리자에게 문의하세요.";
    else if (error.code === "auth/weak-password") text = "비밀번호를 더 강하게 설정해주세요.";
    else if (error.code === "auth/invalid-email") text = "올바른 이메일 주소를 입력해주세요.";
    else if (error.code === "permission-denied") text = "승인 요청 저장이 차단되었습니다. Firestore 규칙을 확인해주세요.";
    setMessage(requestMessage, text);
  } finally {
    requesting = false;
    requestButton.disabled = false;
    requestButton.textContent = "승인 요청 보내기";
  }
});
