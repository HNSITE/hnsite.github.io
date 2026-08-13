import { auth, db } from "./firebase-config.js";

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const googleLoginButton = document.getElementById("googleLoginButton");
const loginMessage = document.getElementById("loginMessage");

const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

let authFlowBusy = false;
let redirecting = false;

function setMessage(text, success = false) {
  if (!loginMessage) {
    return;
  }

  loginMessage.textContent = text;
  loginMessage.classList.toggle("success", success);
}

function setGoogleButtonBusy(busy) {
  if (!googleLoginButton) {
    return;
  }

  googleLoginButton.disabled = busy;

  const label = googleLoginButton.querySelector("span:last-child");

  if (label) {
    label.textContent = busy
      ? "Google 계정 확인 중..."
      : "Google 계정으로 로그인";
  }
}

/*
 * Google 최초 로그인 시 users/{uid} 생성
 *
 * 플랫폼 전체 승인 절차는 사용하지 않는다.
 * 채널 사용 승인은 channels/{channelId}/members/{uid}에서 관리한다.
 */
async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    const profile = userSnap.data();
    const changes = {};

    if (!profile.email && user.email) {
      changes.email = user.email;
    }

    if (!profile.name && user.displayName) {
      changes.name = user.displayName;
    }

    /*
     * 기존 developer 계정은 절대 user로 덮어쓰지 않는다.
     */
    if (
      !profile.platformRole &&
      profile.role !== "developer"
    ) {
      changes.platformRole = "user";
    }

    if (Object.keys(changes).length > 0) {
      changes.updatedAt = serverTimestamp();

      await setDoc(
        userRef,
        changes,
        {
          merge: true
        }
      );
    }

    return;
  }

  /*
   * 신규 Google 사용자
   *
   * status는 기존 코드/데이터 호환용으로만 남긴다.
   * 실제 채널 접근 여부 판단에는 사용하지 않는다.
   */
  await setDoc(userRef, {
    name:
      user.displayName ||
      user.email ||
      "사용자",

    email:
      user.email || "",

    platformRole:
      "user",

    role:
      "user",

    status:
      "approved",

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp()
  });
}

async function moveToChannels(user) {
  if (redirecting) {
    return;
  }

  await ensureUserProfile(user);

  redirecting = true;

  location.replace(
    `./channels.html?_fresh=${Date.now()}`
  );
}

/*
 * 이미 Google 로그인이 되어 있으면
 * 별도 승인 없이 바로 채널 선택 화면으로 이동
 */
onAuthStateChanged(
  auth,
  async (user) => {
    if (
      !user ||
      authFlowBusy ||
      redirecting
    ) {
      return;
    }

    try {
      setMessage("계정 정보를 확인하고 있습니다.");

      await moveToChannels(user);
    } catch (error) {
      console.error(error);

      setMessage(
        error?.code === "permission-denied"
          ? "사용자 정보를 저장할 권한이 없습니다. Firestore 규칙을 확인해주세요."
          : "계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요."
      );
    }
  }
);

/*
 * Google 로그인
 */
googleLoginButton?.addEventListener(
  "click",
  async () => {
    authFlowBusy = true;

    setGoogleButtonBusy(true);
    setMessage("");

    try {
      const result =
        await signInWithPopup(
          auth,
          googleProvider
        );

      await moveToChannels(
        result.user
      );
    } catch (error) {
      console.error(error);

      let text =
        "Google 로그인에 실패했습니다. 다시 시도해주세요.";

      if (
        error.code ===
        "auth/popup-closed-by-user"
      ) {
        text =
          "Google 로그인 창이 닫혔습니다.";
      } else if (
        error.code ===
        "auth/popup-blocked"
      ) {
        text =
          "브라우저에서 팝업이 차단되었습니다. 팝업을 허용해주세요.";
      } else if (
        error.code ===
        "auth/account-exists-with-different-credential"
      ) {
        text =
          "이 이메일은 기존 로그인 방식과 연결되어 있습니다.";
      } else if (
        error.code ===
        "auth/unauthorized-domain"
      ) {
        text =
          "현재 사이트 주소가 Firebase 승인 도메인에 등록되지 않았습니다.";
      } else if (
        error.code ===
        "permission-denied"
      ) {
        text =
          "사용자 정보를 저장할 권한이 없습니다. Firestore 규칙을 확인해주세요.";
      }

      setMessage(text);
    } finally {
      authFlowBusy = false;
      setGoogleButtonBusy(false);
    }
  }
);