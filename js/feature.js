import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { initUserManagementModal } from "./admin-modal.js?v=16";

const feature = document.body.dataset.feature;
const loadingPanel = document.getElementById("loadingPanel");
const featureContent = document.getElementById("featureContent");

const roleLabel = (value) => ({
  super_admin: "최고관리자",
  admin: "관리자",
  user: "일반사용자"
}[value] || value);

const isManager = (profile) => ["super_admin", "admin"].includes(profile?.role);

async function loadProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) throw new Error("등록되지 않은 계정입니다.");
  const profile = snap.data();
  if (profile.status !== "approved") throw new Error("승인되지 않았거나 사용중지된 계정입니다.");
  return profile;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("./index.html");
    return;
  }

  try {
    const profile = await loadProfile(user);
    if (isManager(profile)) initUserManagementModal(profile);
    const field = feature === "bingo" ? "bingoAccess" : "killSheetAccess";
    const access = isManager(profile) ? "write" : (profile[field] || "none");

    if (access === "none") {
      throw new Error("이 메뉴에 접근할 권한이 없습니다.");
    }

    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("roleBadge").textContent = roleLabel(profile.role);
    document.getElementById("featurePermission").textContent = access === "write"
      ? "쓰기 권한으로 이용 중입니다."
      : "읽기 권한으로 이용 중입니다.";

    loadingPanel.classList.add("hidden");
    featureContent.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    loadingPanel.innerHTML = `
      <h2>접근할 수 없습니다.</h2>
      <p>${error.message}</p>
      <a class="service-button inline-button" href="./app.html">메인으로 돌아가기</a>
    `;
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  await signOut(auth);
  location.replace("./index.html");
});
