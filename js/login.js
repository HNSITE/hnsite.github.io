import { auth, db } from "./firebase-config.js";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  loadCurrentChannelContext,
  loadPlatformProfile
} from "./channel-context.js";
import {
  uniqueNameKey,
  userNameRegistryRef,
  validateUserName
} from "./name-registry.js";

const googleLoginButton = document.getElementById("googleLoginButton");
const loginMessage = document.getElementById("loginMessage");
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let busy = false;
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("로그인 유지 설정 실패", error);
});

function setMessage(text, success = false) {
  loginMessage.textContent = text || "";
  loginMessage.classList.toggle("success", success);
}

function setBusy(value) {
  busy = value;
  googleLoginButton.disabled = value;
  const label = googleLoginButton.querySelector("span:last-child");
  if (label) label.textContent = value ? "Google 계정 확인 중..." : "Google 계정으로 로그인";
}

function preferredUserName(user, existingName = "") {
  const source = existingName || user.displayName || (user.email || "").split("@")[0] || "사용자";
  const normalized = String(source).normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 20);
  if (validateUserName(normalized).ok) return normalized;
  return `사용자-${user.uid.slice(0, 4)}`.slice(0, 20);
}

async function claimUserName(user) {
  const userRef = doc(db, "users", user.uid);
  const existingSnapshot = await getDoc(userRef);
  const existingProfile = existingSnapshot.exists() ? existingSnapshot.data() : null;
  if (existingProfile?.nameKey) return;
  const baseName = preferredUserName(user, existingProfile?.name || "");
  const candidates = [
    baseName,
    `${baseName.slice(0, 15)}-${user.uid.slice(0, 4)}`,
    `사용자-${user.uid.slice(0, 8)}`
  ];

  for (const rawCandidate of candidates) {
    const candidate = validateUserName(rawCandidate);
    if (!candidate.ok) continue;
    const registryRef = userNameRegistryRef(candidate.key);

    try {
      await runTransaction(db, async (transaction) => {
        const userSnapshot = await transaction.get(userRef);
        const registrySnapshot = await transaction.get(registryRef);

        if (userSnapshot.exists() && userSnapshot.data().nameKey) return;
        if (registrySnapshot.exists() && registrySnapshot.data().uid !== user.uid) {
          throw new Error("NAME_TAKEN");
        }

        transaction.set(registryRef, {
          uid: user.uid,
          name: candidate.name,
          createdAt: registrySnapshot.exists() ? registrySnapshot.data().createdAt || serverTimestamp() : serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        if (userSnapshot.exists()) {
          transaction.update(userRef, {
            name: candidate.name,
            nameKey: candidate.key,
            updatedAt: serverTimestamp()
          });
        } else {
          transaction.set(userRef, {
            name: candidate.name,
            nameKey: candidate.key,
            email: user.email || "",
            platformRole: "user",
            role: "user",
            status: "approved",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
      });
      return;
    } catch (error) {
      if (error.message === "NAME_TAKEN") continue;
      throw error;
    }
  }

  throw new Error("사용할 수 있는 사용자명을 만들지 못했습니다.");
}

async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  // claimUserName 트랜잭션이 기존 사용자 조회와 최초 사용자 생성을 모두 처리한다.
  await claimUserName(user);
  return userRef;
}

function incomingChannelName() {
  return new URLSearchParams(location.search).get("channel")?.trim() || "";
}

async function handleUser(user) {
  await ensureUserProfile(user);

  const sharedChannelName = incomingChannelName();
  if (sharedChannelName) {
    location.replace(`./channels.html?channel=${encodeURIComponent(sharedChannelName)}`);
    return;
  }

  const profile = await loadPlatformProfile(user);
  try {
    await loadCurrentChannelContext(user, profile);
    location.replace("./app.html");
  } catch (_) {
    location.replace("./channels.html");
  }
}

onAuthStateChanged(auth, async (user) => {
  await persistenceReady;
  if (!user || busy) return;
  try {
    setBusy(true);
    await handleUser(user);
  } catch (error) {
    console.error("로그인 사용자 초기화 실패", error);
    setMessage("계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
    setBusy(false);
  }
});

googleLoginButton.addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  setMessage("");

  try {
    await persistenceReady;
    const result = await signInWithPopup(auth, provider);
    await handleUser(result.user);
  } catch (error) {
    console.error("Google 로그인 실패", error);
    let text = "Google 로그인에 실패했습니다. 다시 시도해주세요.";
    if (error.code === "auth/popup-closed-by-user") text = "Google 로그인 창이 닫혔습니다.";
    else if (error.code === "auth/popup-blocked") text = "브라우저에서 팝업이 차단되었습니다. 팝업을 허용해주세요.";
    else if (error.code === "auth/unauthorized-domain") text = "현재 사이트 주소가 Firebase 승인 도메인에 등록되지 않았습니다.";
    else if (error.code === "permission-denied" || String(error.message || "").includes("Missing or insufficient permissions")) text = "Firestore 사용자 정보를 확인할 권한이 없습니다.";
    setMessage(text);
    setBusy(false);
  }
});
