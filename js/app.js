import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { initUserManagementModal } from "./admin-modal.js?v=24";
import { showNotice } from "./ui-dialog.js?v=14";

const loadingPanel = document.getElementById("loadingPanel");
const appContent = document.getElementById("appContent");

const roleLabel = (value) => ({
  super_admin: "최고관리자",
  admin: "관리자",
  user: "일반사용자"
}[value] || value);

const accessLabel = (value) => ({
  none: "접근 권한 없음",
  read: "보기",
  write: "사용 가능"
}[value] || "접근 권한 없음");

const isManager = (profile) => ["super_admin", "admin"].includes(profile?.role);

async function loadProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) throw new Error("등록되지 않은 계정입니다.");

  const profile = snap.data();
  if (profile.status !== "approved") {
    throw new Error("승인되지 않았거나 사용중지된 계정입니다.");
  }

  return { uid: user.uid, ...profile };
}

function applyServiceAccess(profile, field, textId, buttonId, cardId) {
  const access = isManager(profile) ? "write" : (profile[field] || "none");
  const text = document.getElementById(textId);
  const button = document.getElementById(buttonId);
  const card = document.getElementById(cardId);

  text.textContent = accessLabel(access);
  card.dataset.access = access;

  if (access === "none") {
    button.textContent = "접근 권한 없음";
    button.classList.add("disabled");
    button.setAttribute("aria-disabled", "true");
    button.addEventListener("click", (event) => event.preventDefault());
    return;
  }

  button.textContent = access === "read" ? "보기" : "들어가기";
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("./index.html");
    return;
  }

  try {
    const profile = await loadProfile(user);

    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("roleBadge").textContent = roleLabel(profile.role);
    document.getElementById("welcomeText").textContent = `${profile.name || user.displayName || "사용자"}님, 반가워요.`;

    if (isManager(profile)) {
      const userManagement = initUserManagementModal(profile);
      const params = new URLSearchParams(window.location.search);
      if (params.get("users") === "1") {
        await userManagement.open();
        params.delete("users");
        const nextQuery = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (nextQuery ? `?${nextQuery}` : ""));
      }
    }

    applyServiceAccess(profile, "bingoAccess", "bingoAccess", "bingoButton", "bingoCard");
    applyServiceAccess(profile, "killSheetAccess", "killAccess", "killButton", "killCard");

    loadingPanel.classList.add("hidden");
    appContent.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    loadingPanel.innerHTML = `
      <h2>접근할 수 없습니다.</h2>
      <p>${error.message}</p>
      <button id="backLogin" type="button">로그인 화면으로</button>
    `;

    document.getElementById("backLogin").addEventListener("click", async () => {
      await signOut(auth);
      location.replace("./index.html");
    });
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  await signOut(auth);
  location.replace("./index.html");
});


document.getElementById("killButton").addEventListener("click", (event) => {
  if (event.currentTarget.classList.contains("disabled")) return;
  event.preventDefault();
  showNotice("현재 킬내기 기능을 준비하고 있습니다.", "준비중입니다");
});
