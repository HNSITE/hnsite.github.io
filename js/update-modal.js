const UPDATE_STORAGE_KEY = "churang:last-read-update";
const LATEST_UPDATE_KEY = "2026-08-13-v18";

const updates = [
  {
    date: "2026.08.13",
    title: "빙고 진행 현황 기능 추가",
    items: [
      "빙고판 전체 선택 / 전체 해제 기능을 추가했습니다.",
      "완성 빙고 수, 체크된 칸, 남은 칸을 한눈에 확인할 수 있습니다.",
      "먹은 치킨 수량을 기록하고 총 치킨 수를 확인할 수 있습니다.",
      "빙고방 주소에서 방 ID가 노출되지 않도록 개선했습니다."
    ]
  },
  {
    date: "2026.08.12",
    title: "사용자 관리 기능 개선",
    items: [
      "사용자 검색과 10명 단위 페이징을 추가했습니다.",
      "이름, 구분, 상태 기준 정렬과 오름차순 / 내림차순 정렬을 지원합니다.",
      "사용자 목록이 길어질 경우 모달 내부에서 스크롤할 수 있습니다.",
      "관리자가 사용자를 삭제할 때 연결된 빙고 데이터도 함께 정리되도록 개선했습니다."
    ]
  },
  {
    date: "2026.08.11",
    title: "빙고방 사용성 개선",
    items: [
      "참가자 추가 / 삭제와 검색, 페이징 기능을 추가했습니다.",
      "빙고 체크 상태가 새로고침이나 재접속 후에도 유지됩니다.",
      "빙고 크기는 최대 10 × 10까지 선택할 수 있습니다.",
      "브라우저 기본 알림창을 CHURANG 스타일 팝업으로 변경했습니다."
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
          <p>CHURANG의 최근 변경사항을 확인할 수 있습니다.</p>
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

function markLatestUpdateRead() {
  try {
    localStorage.setItem(UPDATE_STORAGE_KEY, LATEST_UPDATE_KEY);
  } catch (error) {
    console.warn("업데이트 읽음 상태를 저장하지 못했습니다.", error);
  }
  setUnreadBadgeVisible(false);
}

function hasUnreadUpdate() {
  try {
    return localStorage.getItem(UPDATE_STORAGE_KEY) !== LATEST_UPDATE_KEY;
  } catch {
    return true;
  }
}

function openUpdateModal() {
  const modal = createUpdateModal();
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  markLatestUpdateRead();
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

  setUnreadBadgeVisible(hasUnreadUpdate());

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
