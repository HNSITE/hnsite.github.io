import { auth, db } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const googleLoginButton = document.getElementById("googleLoginButton");
const loginMessage = document.getElementById("loginMessage");
const requestPanel = document.getElementById("requestPanel");
const requestForm = document.getElementById("requestForm");
const requestButton = document.getElementById("requestButton");
const requestMessage = document.getElementById("requestMessage");
const passwordLoginForm = document.getElementById("passwordLoginForm");
const passwordLoginButton = document.getElementById("passwordLoginButton");

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

let authFlowBusy = false;
let approvalCandidate = null;

function setMessage(element, text, success = false) {
  element.textContent = text;
  element.classList.toggle("success", success);
}

function setGoogleButtonBusy(busy) {
  googleLoginButton.disabled = busy;
  googleLoginButton.querySelector("span:last-child").textContent = busy
    ? "Google 계정 확인 중..."
    : "Google 계정으로 로그인";
}

async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

async function handleAuthenticatedUser(user) {
  const profile = await getProfile(user.uid);

  if (profile?.status === "approved") {
    location.replace("./app.html");
    return;
  }

  if (profile?.status === "pending") {
    await signOut(auth);
    setMessage(loginMessage, "현재 관리자 승인 대기 중인 계정입니다.");
    return;
  }

  if (profile) {
    await signOut(auth);
    setMessage(loginMessage, "현재 사용할 수 없는 계정입니다. 관리자에게 문의해주세요.");
    return;
  }

  approvalCandidate = user;
  document.getElementById("requestName").value = user.displayName || "";
  document.getElementById("requestEmail").value = user.email || "";
  requestPanel.classList.remove("hidden");
  requestPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  setMessage(loginMessage, "아직 승인되지 않은 계정입니다. 아래에서 사용 승인을 요청해주세요.");
}

onAuthStateChanged(auth, async (user) => {
  if (!user || authFlowBusy || approvalCandidate) return;

  try {
    await handleAuthenticatedUser(user);
  } catch (error) {
    console.error(error);
    setMessage(loginMessage, "계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
});

googleLoginButton.addEventListener("click", async () => {
  authFlowBusy = true;
  setGoogleButtonBusy(true);
  setMessage(loginMessage, "");
  setMessage(requestMessage, "");
  requestPanel.classList.add("hidden");
  approvalCandidate = null;

  try {
    const result = await signInWithPopup(auth, googleProvider);
    await handleAuthenticatedUser(result.user);
  } catch (error) {
    console.error(error);

    let text = "Google 로그인에 실패했습니다. 다시 시도해주세요.";
    if (error.code === "auth/popup-closed-by-user") {
      text = "Google 로그인 창이 닫혔습니다.";
    } else if (error.code === "auth/popup-blocked") {
      text = "브라우저에서 팝업이 차단되었습니다. 팝업을 허용해주세요.";
    } else if (error.code === "auth/account-exists-with-different-credential") {
      text = "이 이메일은 기존 비밀번호 계정으로 등록되어 있습니다. 최고관리자라면 아래 비밀번호 로그인을 사용해주세요.";
    } else if (error.code === "auth/unauthorized-domain") {
      text = "현재 사이트 주소가 Firebase 승인 도메인에 등록되지 않았습니다.";
    }

    setMessage(loginMessage, text);
  } finally {
    authFlowBusy = false;
    setGoogleButtonBusy(false);
  }
});

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(requestMessage, "");

  if (!approvalCandidate || !auth.currentUser || auth.currentUser.uid !== approvalCandidate.uid) {
    setMessage(requestMessage, "Google 계정을 다시 선택해주세요.");
    return;
  }

  const name = document.getElementById("requestName").value.trim();
  const email = approvalCandidate.email || "";

  if (!name) {
    setMessage(requestMessage, "이름을 입력해주세요.");
    return;
  }

  requestButton.disabled = true;
  requestButton.textContent = "요청 중...";

  try {
    await setDoc(doc(db, "users", approvalCandidate.uid), {
      name,
      email,
      role: "user",
      status: "pending",
      bingoAccess: "none",
      killSheetAccess: "none",
      createdAt: serverTimestamp()
    });

    await signOut(auth);
    approvalCandidate = null;
    requestPanel.classList.add("hidden");
    setMessage(loginMessage, "승인 요청이 완료되었습니다. 관리자가 승인하면 같은 Google 계정으로 바로 로그인할 수 있습니다.", true);
  } catch (error) {
    console.error(error);
    const text = error.code === "permission-denied"
      ? "승인 요청 저장이 차단되었습니다. Firestore 규칙을 확인해주세요."
      : "승인 요청에 실패했습니다. 잠시 후 다시 시도해주세요.";
    setMessage(requestMessage, text);
  } finally {
    requestButton.disabled = false;
    requestButton.textContent = "승인 요청 보내기";
  }
});

document.getElementById("cancelRequestButton").addEventListener("click", async () => {
  if (auth.currentUser) await signOut(auth);
  approvalCandidate = null;
  requestForm.reset();
  requestPanel.classList.add("hidden");
  setMessage(requestMessage, "");
  setMessage(loginMessage, "다른 Google 계정으로 로그인해주세요.");
});

passwordLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(loginMessage, "");
  passwordLoginButton.disabled = true;
  passwordLoginButton.textContent = "로그인 중...";
  authFlowBusy = true;

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      document.getElementById("adminEmail").value.trim(),
      document.getElementById("adminPassword").value
    );
    await handleAuthenticatedUser(credential.user);
  } catch (error) {
    console.error(error);
    setMessage(loginMessage, "비밀번호 로그인에 실패했습니다. 이메일과 비밀번호를 확인해주세요.");
  } finally {
    authFlowBusy = false;
    passwordLoginButton.disabled = false;
    passwordLoginButton.textContent = "비밀번호로 로그인";
  }
});
