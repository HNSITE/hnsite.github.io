import {
  auth,
  db
} from "./firebase-config.js";

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


const googleLoginButton =
  document.getElementById(
    "googleLoginButton"
  );

const loginMessage =
  document.getElementById(
    "loginMessage"
  );


const provider =
  new GoogleAuthProvider();


provider.setCustomParameters({
  prompt:
    "select_account"
});


let busy =
  false;


/* =========================================================
   메시지
========================================================= */

function setMessage(
  text,
  success = false
) {

  loginMessage.textContent =
    text || "";


  loginMessage.classList.toggle(
    "success",
    success
  );
}


function setBusy(
  value
) {

  busy =
    value;


  googleLoginButton.disabled =
    value;


  const label =
    googleLoginButton.querySelector(
      "span:last-child"
    );


  if (label) {

    label.textContent =
      value
        ? "Google 계정 확인 중..."
        : "Google 계정으로 로그인";
  }
}


/* =========================================================
   users/{uid} 자동 생성
========================================================= */

async function ensureUserProfile(
  user
) {

  const userRef =
    doc(
      db,
      "users",
      user.uid
    );


  const snapshot =
    await getDoc(
      userRef
    );


  /*
   * 기존 사용자
   *
   * 로그인할 때 기존 사용자 문서는
   * 절대 수정하지 않는다.
   *
   * role / platformRole / status 등의
   * 기존 권한 정보도 그대로 유지한다.
   */
  if (
    snapshot.exists()
  ) {

    return;
  }


  /*
   * 최초 Google 로그인 사용자
   */
  await setDoc(
    userRef,
    {
      name:
        user.displayName ||
        user.email ||
        "사용자",

      email:
        user.email ||
        "",

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
    }
  );
}


/* =========================================================
   로그인 완료 이동
========================================================= */

async function handleUser(
  user
) {

  await ensureUserProfile(
    user
  );


  location.replace(
    "./channels.html"
  );
}


/* =========================================================
   기존 로그인 상태
========================================================= */

onAuthStateChanged(
  auth,
  async (
    user
  ) => {

    if (
      !user ||
      busy
    ) {

      return;
    }


    try {

      setBusy(
        true
      );


      await handleUser(
        user
      );

    } catch (error) {

      console.error(
        "로그인 사용자 초기화 실패",
        error
      );


      setMessage(
        "계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요."
      );


      setBusy(
        false
      );
    }
  }
);


/* =========================================================
   Google 로그인
========================================================= */

googleLoginButton.addEventListener(
  "click",
  async () => {

    if (
      busy
    ) {

      return;
    }


    setBusy(
      true
    );


    setMessage(
      ""
    );


    try {

      const result =
        await signInWithPopup(
          auth,
          provider
        );


      await handleUser(
        result.user
      );

    } catch (error) {

      console.error(
        "Google 로그인 실패",
        error
      );


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
        "auth/unauthorized-domain"
      ) {

        text =
          "현재 사이트 주소가 Firebase 승인 도메인에 등록되지 않았습니다.";

      } else if (
        error.code ===
        "permission-denied" ||
        String(
          error.message ||
          ""
        ).includes(
          "Missing or insufficient permissions"
        )
      ) {

        text =
          "Firestore 사용자 정보를 확인할 권한이 없습니다.";
      }


      setMessage(
        text
      );


      setBusy(
        false
      );
    }
  }
);