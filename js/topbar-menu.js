const nav = document.querySelector(".topbar-user");
const header = nav?.closest(".app-topbar");

const MANAGE_ACTION_IDS = [
  "globalChannelManagementButton",
  "openCreateChannelButton",
  "globalCreateChannelButton",
  "openChannelRequestsButton",
  "globalChannelRequestsButton",
  "adminDashboardButton",
  "channelMemberApprovalButton",
  "channelOwnerSettingsButton",
  "channelShareButton"
];

const MANAGE_BADGE_IDS = [
  "channelMemberPendingBadge",
  "channelRequestBadge",
  "globalChannelRequestBadge"
];

let currentProfile = null;
let currentContext = null;
let currentUser = null;
let observer = null;
let syncQueued = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function roleLabel() {
  if (
    currentProfile?.platformRole === "developer" ||
    currentProfile?.role === "developer"
  ) {
    return "개발자";
  }

  const role = currentContext?.member?.role;
  return {
    owner: "소유자",
    admin: "관리자",
    member: "멤버"
  }[role] || "사용자";
}

function profileName() {
  return (
    currentProfile?.name ||
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "내 정보"
  );
}

function profileEmail() {
  return currentUser?.email || currentProfile?.email || "";
}

function currentPathName() {
  return location.pathname.split("/").pop() || "index.html";
}

function featureLinks() {
  if (!currentContext?.channel) return [];

  const memberStatus = currentContext?.member?.status;
  const developer =
    currentProfile?.platformRole === "developer" ||
    currentProfile?.role === "developer";
  const approved = developer || ["approved", "active"].includes(memberStatus);

  const links = [
    { href: "./app.html", label: "홈", key: "app" }
  ];

  if (approved && currentContext.channel.bingoEnabled === true) {
    links.push({ href: "./bingo.html", label: "빙고", key: "bingo" });
  }

  if (approved && currentContext.channel.killEnabled === true) {
    links.push({ href: "./kill.html", label: "킬내기", key: "kill" });
  }

  return links;
}

function activeKey() {
  const path = currentPathName();
  if (path === "bingo.html" || path === "bingo-room.html") return "bingo";
  if (path === "kill.html") return "kill";
  if (path === "app.html") return "app";
  return "";
}

function ensureShell() {
  if (!nav || !header) return null;

  if (!document.getElementById("topbarChannelWrap")) {
    const channelWrap = document.createElement("div");
    channelWrap.id = "topbarChannelWrap";
    channelWrap.className = "topbar-dropdown topbar-channel-wrap hidden";
    channelWrap.innerHTML = `
      <button id="topbarChannelTrigger" class="topbar-compact-trigger topbar-channel-trigger" type="button" aria-expanded="false">
        <span class="topbar-channel-dot" aria-hidden="true">H</span>
        <span id="topbarChannelLabel" class="topbar-trigger-label">채널</span>
        <span class="topbar-caret" aria-hidden="true">⌄</span>
      </button>
      <div id="topbarChannelMenu" class="topbar-dropdown-menu topbar-channel-dropdown hidden">
        <div class="topbar-dropdown-heading">
          <small>현재 채널</small>
          <strong id="topbarChannelMenuName">-</strong>
        </div>
        <a class="topbar-dropdown-action" href="./channels.html">채널 변경</a>
      </div>
    `;
    nav.insertBefore(channelWrap, nav.firstChild);
  }

  if (!document.getElementById("topbarPrimaryLinks")) {
    const primary = document.createElement("div");
    primary.id = "topbarPrimaryLinks";
    primary.className = "topbar-primary-links";
    const channelWrap = document.getElementById("topbarChannelWrap");
    channelWrap.insertAdjacentElement("afterend", primary);
  }

  if (!document.getElementById("topbarUpdateSlot")) {
    const updateSlot = document.createElement("div");
    updateSlot.id = "topbarUpdateSlot";
    updateSlot.className = "topbar-update-slot";
    nav.appendChild(updateSlot);
  }

  if (!document.getElementById("topbarManageWrap")) {
    const manageWrap = document.createElement("div");
    manageWrap.id = "topbarManageWrap";
    manageWrap.className = "topbar-dropdown topbar-manage-wrap hidden";
    manageWrap.innerHTML = `
      <button id="topbarManageTrigger" class="topbar-compact-trigger" type="button" aria-expanded="false">
        <span>관리</span>
        <span id="topbarManageBadge" class="topbar-count-badge hidden">0</span>
        <span class="topbar-caret" aria-hidden="true">⌄</span>
      </button>
      <div id="topbarManageMenu" class="topbar-dropdown-menu topbar-manage-menu hidden">
        <div class="topbar-dropdown-heading">
          <small>MANAGEMENT</small>
          <strong>관리 메뉴</strong>
        </div>
      </div>
    `;
    nav.appendChild(manageWrap);
  }

  if (!document.getElementById("topbarProfileWrap")) {
    const profileWrap = document.createElement("div");
    profileWrap.id = "topbarProfileWrap";
    profileWrap.className = "topbar-dropdown topbar-profile-wrap";
    profileWrap.innerHTML = `
      <button id="topbarProfileTrigger" class="topbar-compact-trigger topbar-profile-trigger" type="button" aria-expanded="false">
        <span id="topbarProfileInitial" class="topbar-profile-initial" aria-hidden="true">H</span>
        <span id="topbarProfileName" class="topbar-trigger-label">내 정보</span>
        <span class="topbar-caret" aria-hidden="true">⌄</span>
      </button>
      <div id="topbarProfileMenu" class="topbar-dropdown-menu topbar-profile-menu hidden">
        <div class="topbar-profile-meta">
          <strong id="topbarProfileMenuName">내 정보</strong>
          <span id="topbarProfileMenuEmail"></span>
          <small id="topbarProfileMenuRole"></small>
        </div>
        <div id="topbarProfileActions" class="topbar-profile-actions"></div>
        <button id="topbarLogoutProxy" class="topbar-dropdown-action topbar-logout-action" type="button">로그아웃</button>
      </div>
    `;
    nav.appendChild(profileWrap);
  }

  if (!document.getElementById("topbarMobileToggle")) {
    const mobileToggle = document.createElement("button");
    mobileToggle.id = "topbarMobileToggle";
    mobileToggle.className = "topbar-mobile-toggle";
    mobileToggle.type = "button";
    mobileToggle.setAttribute("aria-label", "메뉴 열기");
    mobileToggle.setAttribute("aria-expanded", "false");
    mobileToggle.innerHTML = '<span aria-hidden="true">☰</span>';
    header.appendChild(mobileToggle);
  }

  bindShellEvents();
  syncTopbar();
  return nav;
}

function bindShellEvents() {
  if (!nav || nav.dataset.topbarBound === "1") return;
  nav.dataset.topbarBound = "1";

  const pairs = [
    ["topbarChannelTrigger", "topbarChannelMenu"],
    ["topbarManageTrigger", "topbarManageMenu"],
    ["topbarProfileTrigger", "topbarProfileMenu"]
  ];

  pairs.forEach(([triggerId, menuId]) => {
    document.getElementById(triggerId)?.addEventListener("click", (event) => {
      event.stopPropagation();
      const trigger = document.getElementById(triggerId);
      const menu = document.getElementById(menuId);
      const opening = menu?.classList.contains("hidden");
      closeDropdowns();
      if (opening && menu && trigger) {
        menu.classList.remove("hidden");
        trigger.setAttribute("aria-expanded", "true");
      }
    });
  });

  document.getElementById("topbarMobileToggle")?.addEventListener("click", () => {
    const opening = !header.classList.contains("topbar-mobile-open");
    header.classList.toggle("topbar-mobile-open", opening);
    const toggle = document.getElementById("topbarMobileToggle");
    toggle?.setAttribute("aria-expanded", opening ? "true" : "false");
    if (!opening) closeDropdowns();
  });

  document.getElementById("topbarLogoutProxy")?.addEventListener("click", () => {
    closeAllMenus();
    document.getElementById("logoutButton")?.click();
  });

  document.getElementById("topbarManageMenu")?.addEventListener("click", (event) => {
    if (event.target.closest("button,a")) {
      setTimeout(closeAllMenus, 0);
    }
  });

  document.getElementById("topbarProfileActions")?.addEventListener("click", (event) => {
    if (event.target.closest("button,a")) {
      setTimeout(closeAllMenus, 0);
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".app-topbar")) closeAllMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllMenus();
  });
}

function closeDropdowns() {
  [
    ["topbarChannelTrigger", "topbarChannelMenu"],
    ["topbarManageTrigger", "topbarManageMenu"],
    ["topbarProfileTrigger", "topbarProfileMenu"]
  ].forEach(([triggerId, menuId]) => {
    document.getElementById(menuId)?.classList.add("hidden");
    document.getElementById(triggerId)?.setAttribute("aria-expanded", "false");
  });
}

function closeAllMenus() {
  closeDropdowns();
  header?.classList.remove("topbar-mobile-open");
  document.getElementById("topbarMobileToggle")?.setAttribute("aria-expanded", "false");
}

function renderPrimaryLinks() {
  const container = document.getElementById("topbarPrimaryLinks");
  if (!container) return;

  const active = activeKey();
  const links = featureLinks();

  container.innerHTML = links
    .map((item) => `
      <a
        class="topbar-primary-link${active === item.key ? " active" : ""}"
        href="${item.href}"
      >${escapeHtml(item.label)}</a>
    `)
    .join("");

  container.classList.toggle("hidden", links.length === 0);
}

function renderContext() {
  const channelWrap = document.getElementById("topbarChannelWrap");
  const channelName = currentContext?.channel?.name || "";

  if (channelWrap) {
    channelWrap.classList.toggle("hidden", !channelName);
  }

  if (channelName) {
    const label = document.getElementById("topbarChannelLabel");
    const menuName = document.getElementById("topbarChannelMenuName");
    if (label) label.textContent = channelName;
    if (menuName) menuName.textContent = channelName;
  }

  renderPrimaryLinks();
  renderProfile();
}

function renderProfile() {
  const name = profileName();
  const email = profileEmail();
  const role = roleLabel();
  const initial = name.trim().charAt(0).toUpperCase() || "H";

  const nameNode = document.getElementById("topbarProfileName");
  const initialNode = document.getElementById("topbarProfileInitial");
  const menuName = document.getElementById("topbarProfileMenuName");
  const menuEmail = document.getElementById("topbarProfileMenuEmail");
  const menuRole = document.getElementById("topbarProfileMenuRole");

  if (nameNode) nameNode.textContent = name;
  if (initialNode) initialNode.textContent = initial;
  if (menuName) menuName.textContent = name;
  if (menuEmail) menuEmail.textContent = email;
  if (menuRole) menuRole.textContent = role;
}

function isActionVisible(element) {
  return Boolean(
    element &&
    !element.classList.contains("hidden") &&
    element.getAttribute("aria-hidden") !== "true"
  );
}

function syncKnownActions() {
  if (!nav) return;

  const manageMenu = document.getElementById("topbarManageMenu");
  const profileActions = document.getElementById("topbarProfileActions");
  const updateSlot = document.getElementById("topbarUpdateSlot");

  MANAGE_ACTION_IDS.forEach((id, index) => {
    const action = document.getElementById(id);
    if (!action || !manageMenu) return;
    action.dataset.topbarOrder = String(index);
    action.style.order = String(index + 1);
    action.classList.add("topbar-dropdown-action");
    if (action.parentElement !== manageMenu) manageMenu.appendChild(action);
  });

  const profileButton = document.getElementById("profileManageButton");
  if (profileButton && profileActions) {
    profileButton.classList.add("topbar-dropdown-action");
    if (profileButton.parentElement !== profileActions) {
      profileActions.appendChild(profileButton);
    }
  }

  const updateButton = document.getElementById("updateNewsButton");
  if (updateButton && updateSlot && updateButton.parentElement !== updateSlot) {
    updateSlot.appendChild(updateButton);
  }

  const visibleManageActions = MANAGE_ACTION_IDS
    .map((id) => document.getElementById(id))
    .filter(isActionVisible);

  document
    .getElementById("topbarManageWrap")
    ?.classList.toggle("hidden", visibleManageActions.length === 0);

  syncManageBadge();
}

function syncManageBadge() {
  const badge = document.getElementById("topbarManageBadge");
  if (!badge) return;

  let count = 0;
  MANAGE_BADGE_IDS.forEach((id) => {
    const item = document.getElementById(id);
    if (!item || item.classList.contains("hidden")) return;
    const value = Number.parseInt(item.textContent, 10);
    if (Number.isFinite(value)) count += value;
  });

  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count <= 0);
}

function syncLegacyText() {
  if (currentContext?.channel?.name) return;

  const channelName = document.getElementById("currentChannelName")?.textContent?.trim();
  if (channelName) {
    const wrap = document.getElementById("topbarChannelWrap");
    wrap?.classList.remove("hidden");
    const label = document.getElementById("topbarChannelLabel");
    const menuName = document.getElementById("topbarChannelMenuName");
    if (label) label.textContent = channelName;
    if (menuName) menuName.textContent = channelName;
  }
}

function syncTopbar() {
  if (!nav) return;
  syncKnownActions();
  syncLegacyText();
  renderProfile();
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    syncTopbar();
  });
}

function startObserver() {
  if (!nav || observer) return;
  observer = new MutationObserver(scheduleSync);
  observer.observe(nav, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
    attributeFilter: ["class", "aria-hidden"]
  });
}

export function setTopbarContext({ user = null, profile = null, context = null } = {}) {
  currentUser = user || currentUser;
  currentProfile = profile || currentProfile;
  currentContext = context;
  ensureShell();
  renderContext();
  scheduleSync();
}

export function refreshTopbarMenu() {
  ensureShell();
  scheduleSync();
}

if (nav && header) {
  ensureShell();
  startObserver();
}
