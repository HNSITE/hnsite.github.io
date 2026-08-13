const UPDATE_BADGE_DAYS = 3;

const updates = [
  {
    date: "2026.08.13",
    title: "알파벳 빙고가 추가됐어요",
    items: [
      "빙고방 생성 시 숫자 빙고와 알파벳 빙고를 선택할 수 있습니다.",
      "알파벳은 무작위 배치 또는 직접 지정할 수 있으며, 직접 지정할 때 같은 알파벳을 여러 번 사용할 수 있습니다."
    ]
  },
  {
    date: "2026.08.13",
    title: "빙고가 더 편리해졌어요",
    items: [
      "빙고판에서 전체 선택과 전체 해제를 사용할 수 있습니다.",
      "체크된 칸, 남은 칸, 완성된 빙고 수를 한눈에 확인할 수 있습니다.",
      "먹은 치킨 수량을 기록하고 총 치킨 수를 확인할 수 있습니다."
    ]
  },
  {
    date: "2026.08.11",
    title: "빙고방 이용 기능이 개선됐어요",
    items: [
      "체크한 빙고 칸은 새로고침하거나 다시 접속해도 그대로 유지됩니다.",
      "방장은 참가자를 추가하거나 제외할 수 있으며 검색과 페이지 이동으로 쉽게 찾을 수 있습니다.",
      "빙고판은 최대 10 × 10까지 만들 수 있습니다."
    ]
  }
];

function createUpdateButton() {
  const topbarUser = document.querySelector(".topbar-user");
  if (!topbarUser || document.getElementById("updateNewsButton")) return null;

  const button = document.createElement("button");
  button.id = "updateNewsButton";
  button.className = "update-news-button";
  button.type = "button";
  button.innerHTML = `
    <span class="update-news-label">업데이트</span>
    <span id="updateUnreadBadge" class="update-unread-badge hidden">NEW</span>
  `;

  const logoutButton = topbarUser.querySelector("#logoutButton");
  if (logoutButton) {
    topbarUser.insertBefore(button, logoutButton);
  } else {
    topbarUser.appendChild(button);
  }

  return button;
}

function createUpdateModal() {
  if (document.getElementById("updateNewsModal")) {
    return document.getElementById("updateNewsModal");
  }

  const modal = document.createElement("div");
  modal.id = "updateNewsModal";
  modal.className = "update-news-modal hidden";
  modal.innerHTML = `
    <div class="update-news-backdrop" data-close-update-modal></div>
    <section class="update-news-dialog" role="dialog" aria-modal="true" aria-labelledby="updateNewsTitle">
      <div class="update-news-header">
        <div>
          <p class="eyebrow">WHAT'S NEW</p>
          <h2 id="updateNewsTitle">업데이트 소식</h2>
          <p>사용에 필요한 주요 변경사항만 안내합니다.</p>
        </div>
        <button class="modal-close-button" type="button" aria-label="업데이트 창 닫기" data-close-update-modal>×</button>
      </div>
      <div class="update-news-list">
        ${updates.map((update, index) => `
          <article class="update-news-item${index === 0 ? " latest" : ""}">
            <div class="update-news-item-head">
              <time>${update.date}</time>
              ${index === 0 ? '<span class="update-latest-pill">최신</span>' : ""}
            </div>
            <h3>${update.title}</h3>
            <ul>
              ${update.items.map((item) => `<li>${item}</li>`).join("")}
            </ul>
          </article>
        `).join("")}
      </div>
    </section>
  `;

  document.body.appendChild(modal);
  return modal;
}

function setUnreadBadgeVisible(visible) {
  document.getElementById("updateUnreadBadge")?.classList.toggle("hidden", !visible);
}

function parseUpdateDate(value) {
  const parts = String(value || "").split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function isLatestUpdateInBadgeWindow() {
  const latestDate = parseUpdateDate(updates[0]?.date);
  if (!latestDate) return false;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiresAt = new Date(latestDate);
  expiresAt.setDate(expiresAt.getDate() + UPDATE_BADGE_DAYS);

  return today >= latestDate && today < expiresAt;
}

function openUpdateModal() {
  const modal = createUpdateModal();
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeUpdateModal() {
  const modal = document.getElementById("updateNewsModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

export function initUpdateModal() {
  const button = createUpdateButton();
  const modal = createUpdateModal();
  if (!button || !modal) return;

  setUnreadBadgeVisible(isLatestUpdateInBadgeWindow());

  button.addEventListener("click", openUpdateModal);
  modal.querySelectorAll("[data-close-update-modal]").forEach((element) => {
    element.addEventListener("click", closeUpdateModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) {
      closeUpdateModal();
    }
  });
}

initUpdateModal();
