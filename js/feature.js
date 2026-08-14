import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { firebaseErrorMessage } from "./error-messages.js";
import { initChannelMemberApproval } from "./channel-members.js";
import { initDeveloperChannelTools } from "./developer-channel-tools.js";
import { initChannelOwnerTools } from "./channel-owner-tools.js";
import { displayRole, isDeveloper, loadCurrentChannelContext, loadPlatformProfile, resolvedFeatureAccess,
  watchCurrentChannelAccess
} from "./channel-context.js";

const feature = document.body.dataset.feature;
let stopChannelAccessWatcher = null;

const loadingPanel = document.getElementById("loadingPanel");
const featureContent = document.getElementById("featureContent");

onAuthStateChanged(auth, async (user) => {
  if (!user) return location.replace("./index.html");
  try {
    const profile = await loadPlatformProfile(user);
    const context = await loadCurrentChannelContext(user, profile);
    await initDeveloperChannelTools(user, profile, context);
    initChannelOwnerTools(user, profile, context);
    stopChannelAccessWatcher?.();
    stopChannelAccessWatcher = watchCurrentChannelAccess(user, profile, context, { feature });
    initChannelMemberApproval(context);
    const access = resolvedFeatureAccess(context, feature === "bingo" ? "bingo" : "kill");
    if (access === "none") throw new Error("이 메뉴에 접근할 권한이 없습니다.");

    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("currentChannelName").textContent = context.channel.name || "HNSITE";
    const roleBadge = document.getElementById("roleBadge");
    roleBadge.textContent = displayRole(context);
    roleBadge.dataset.role = isDeveloper(profile) ? "developer" : context.member.role;
    document.getElementById("featurePermission").textContent = access === "write" ? "사용 권한으로 이용 중입니다." : "보기 권한으로 이용 중입니다.";
    loadingPanel.classList.add("hidden");
    featureContent.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    if (["NO_CHANNEL", "CHANNEL_NOT_FOUND", "CHANNEL_INACTIVE"].includes(error.code)) return location.replace("./channels.html");
    loadingPanel.innerHTML = `<h2>접근할 수 없습니다.</h2><p>${firebaseErrorMessage(error, error.message || "이 메뉴에 접근할 수 없습니다.")}</p><a class="service-button inline-button" href="./app.html">메인으로 돌아가기</a>`;
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => { stopChannelAccessWatcher?.(); await signOut(auth); location.replace("./index.html"); });
