import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { initUserManagementModal } from "./admin-modal.js?v=28";
import { initAdminDashboard } from "./admin-dashboard.js?v=28";
import { showNotice } from "./ui-dialog.js?v=28";
import { firebaseErrorMessage } from "./error-messages.js?v=28";
import {
  accessLabel,
  displayRole,
  isDeveloper,
  loadCurrentChannelContext,
  loadPlatformProfile,
  resolvedFeatureAccess
} from "./channel-context.js?v=28";

const loadingPanel = document.getElementById("loadingPanel");
const appContent = document.getElementById("appContent");

function applyServiceAccess(context, feature, textId, buttonId, cardId) {
  const access = resolvedFeatureAccess(context, feature);
  const text = document.getElementById(textId);
  const button = document.getElementById(buttonId);
  const card = document.getElementById(cardId);
  text.textContent = feature === "kill" && context.channel.killEnabled !== true ? "준비중" : accessLabel(access);
  card.dataset.access = access;

  if (access === "none") {
    button.textContent = feature === "kill" ? "준비중" : "접근 권한 없음";
    button.classList.add("disabled");
    button.setAttribute("aria-disabled", "true");
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
    const profile = await loadPlatformProfile(user);
    const context = await loadCurrentChannelContext(user, profile);

    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("currentChannelName").textContent = context.channel.name || "HNSITE";
    const roleBadge = document.getElementById("roleBadge");
    roleBadge.textContent = displayRole(context);
    roleBadge.dataset.role = isDeveloper(profile) ? "developer" : context.member.role;
    document.getElementById("welcomeText").textContent = `${profile.name || user.displayName || "사용자"}님, ${context.channel.name || "채널"}에 접속했습니다.`;

    initAdminDashboard(profile, context);
    if (isDeveloper(profile)) {
      const userManagement = initUserManagementModal(profile);
      const params = new URLSearchParams(window.location.search);
      if (params.get("users") === "1") {
        await userManagement.open();
        params.delete("users");
        const nextQuery = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (nextQuery ? `?${nextQuery}` : ""));
      }
    }

    applyServiceAccess(context, "bingo", "bingoAccess", "bingoButton", "bingoCard");
    applyServiceAccess(context, "kill", "killAccess", "killButton", "killCard");

    loadingPanel.classList.add("hidden");
    appContent.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    if (["NO_CHANNEL", "CHANNEL_NOT_FOUND", "CHANNEL_INACTIVE"].includes(error.code)) {
      location.replace("./channels.html");
      return;
    }
    loadingPanel.innerHTML = `
      <h2>접근할 수 없습니다.</h2>
      <p>${firebaseErrorMessage(error, error.message || "접근할 수 없습니다.")}</p>
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
  event.preventDefault();
  showNotice("현재 킬내기 기능을 준비하고 있습니다.", "준비중입니다");
});
