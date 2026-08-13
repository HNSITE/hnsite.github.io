import {
  db
} from "./firebase-config.js";

import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  firebaseErrorMessage
} from "./error-messages.js?v=33";

import {
  isChannelManager,
  normalizeMemberStatus
} from "./channel-context.js?v=33";


const PAGE_SIZE =
  10;


let currentContext =
  null;

let pendingMembers =
  [];

let page =
  1;

let unsubscribe =
  null;


/* =========================================================
   공통
========================================================= */

function escapeHtml(
  value
) {
  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* =========================================================
   상단 가입 승인 버튼
========================================================= */

function ensureButton() {

  if (
    !isChannelManager(
      currentContext
    )
  ) {
    return null;
  }


  let button =
    document.getElementById(
      "channelMemberApprovalButton"
    );


  if (button) {
    return button;
  }


  const nav =
    document.querySelector(
      ".topbar-user"
    );


  if (!nav) {
    return null;
  }


  button =
    document.createElement(
      "button"
    );


  button.id =
    "channelMemberApprovalButton";


  button.className =
    "topbar-link channel-member-approval-button";


  button.type =
    "button";


  button.innerHTML = `
    가입 승인

    <span
      id="channelMemberPendingBadge"
      class="admin-pending-badge hidden"
    >
      0
    </span>
  `;


  const email =
    nav.querySelector(
      ".topbar-email"
    );


  nav.insertBefore(
    button,
    email ||
    nav.firstChild
  );


  return button;
}


/* =========================================================
   승인 모달
========================================================= */

function ensureModal() {

  let modal =
    document.getElementById(
      "channelMemberApprovalModal"
    );


  if (modal) {
    return modal;
  }


  modal =
    document.createElement(
      "div"
    );


  modal.id =
    "channelMemberApprovalModal";


  modal.className =
    "admin-modal hidden";


  modal.innerHTML = `
    <div
      class="admin-modal-backdrop"
      data-close-channel-approval
    ></div>

    <section
      class="admin-modal-dialog channel-member-approval-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channelMemberApprovalTitle"
    >

      <div class="admin-modal-header">

        <div>

          <p class="eyebrow">
            CHANNEL MEMBER
          </p>

          <h2 id="channelMemberApprovalTitle">
            채널 가입 승인
          </h2>

          <p class="muted">
            가입 신청은 승인만 할 수 있습니다.
          </p>

        </div>

        <button
          class="modal-close-button"
          data-close-channel-approval
          type="button"
          aria-label="닫기"
        >
          ×
        </button>

      </div>


      <p
        id="channelMemberApprovalMessage"
        class="message admin-modal-message"
      ></p>


      <div
        id="channelMemberApprovalList"
        class="channel-request-list"
      ></div>


      <div
        id="channelMemberApprovalPagination"
        class="channel-pagination channel-request-pagination hidden"
      >

        <span
          id="channelMemberApprovalSummary"
          class="channel-page-summary"
        ></span>


        <div class="channel-page-buttons">

          <button
            id="channelMemberApprovalPrev"
            class="secondary"
            type="button"
          >
            이전
          </button>


          <span
            id="channelMemberApprovalPage"
            class="channel-page-number"
          ></span>


          <button
            id="channelMemberApprovalNext"
            class="secondary"
            type="button"
          >
            다음
          </button>

        </div>

      </div>

    </section>
  `;


  document.body.appendChild(
    modal
  );


  modal
    .querySelectorAll(
      "[data-close-channel-approval]"
    )
    .forEach(
      (element) => {

        element.addEventListener(
          "click",
          closeModal
        );
      }
    );


  modal
    .querySelector(
      "#channelMemberApprovalPrev"
    )
    .addEventListener(
      "click",
      () => {

        if (
          page <= 1
        ) {
          return;
        }


        page -= 1;


        render();
      }
    );


  modal
    .querySelector(
      "#channelMemberApprovalNext"
    )
    .addEventListener(
      "click",
      () => {

        page += 1;


        render();
      }
    );


  return modal;
}


/* =========================================================
   배지
========================================================= */

function setBadge(
  count
) {

  const badge =
    document.getElementById(
      "channelMemberPendingBadge"
    );


  if (!badge) {
    return;
  }


  badge.textContent =
    count > 99
      ? "99+"
      : String(count);


  badge.classList.toggle(
    "hidden",
    count === 0
  );
}


/* =========================================================
   모달 열기/닫기
========================================================= */

function openModal() {

  if (
    !isChannelManager(
      currentContext
    )
  ) {
    return;
  }


  const modal =
    ensureModal();


  page =
    1;


  modal.classList.remove(
    "hidden"
  );


  document.body.classList.add(
    "modal-open"
  );


  render();
}


function closeModal() {

  document
    .getElementById(
      "channelMemberApprovalModal"
    )
    ?.classList
    .add(
      "hidden"
    );


  document.body.classList.remove(
    "modal-open"
  );
}


/* =========================================================
   목록 렌더링
========================================================= */

function render() {

  const list =
    document.getElementById(
      "channelMemberApprovalList"
    );


  const pagination =
    document.getElementById(
      "channelMemberApprovalPagination"
    );


  const message =
    document.getElementById(
      "channelMemberApprovalMessage"
    );


  if (
    !list ||
    !pagination ||
    !message
  ) {
    return;
  }


  list.innerHTML =
    "";


  if (
    !pendingMembers.length
  ) {

    list.innerHTML = `
      <div class="channel-request-empty">
        현재 승인 대기 중인 사용자가 없습니다.
      </div>
    `;


    pagination.classList.add(
      "hidden"
    );


    return;
  }


  const totalPages =
    Math.max(
      1,
      Math.ceil(
        pendingMembers.length /
        PAGE_SIZE
      )
    );


  page =
    Math.min(
      Math.max(
        1,
        page
      ),
      totalPages
    );


  const start =
    (
      page - 1
    ) *
    PAGE_SIZE;


  const items =
    pendingMembers.slice(
      start,
      start +
      PAGE_SIZE
    );


  items.forEach(
    (member) => {

      const item =
        document.createElement(
          "article"
        );


      item.className =
        "channel-request-item";


      item.innerHTML = `
        <div class="channel-request-info">

          <strong>
            ${escapeHtml(
              member.name ||
              member.email ||
              "사용자"
            )}
          </strong>

          <span>
            ${escapeHtml(
              member.email ||
              ""
            )}
          </span>

          <small>
            채널 가입 승인 대기
          </small>

        </div>

        <div class="channel-request-actions">

          <button
            class="approve-channel-member-button"
            type="button"
          >
            승인
          </button>

        </div>
      `;


      item
        .querySelector(
          ".approve-channel-member-button"
        )
        .addEventListener(
          "click",
          async (
            event
          ) => {

            const button =
              event.currentTarget;


            button.disabled =
              true;


            button.textContent =
              "승인 중...";


            try {

              await approveMember(
                member
              );


              message.textContent =
                `${
                  member.name ||
                  member.email ||
                  "사용자"
                }님의 가입을 승인했습니다.`;


              message.classList.add(
                "success"
              );

            } catch (error) {

              console.error(
                "채널 가입 승인 실패",
                error
              );


              message.classList.remove(
                "success"
              );


              message.textContent =
                firebaseErrorMessage(
                  error,
                  "채널 가입 승인에 실패했습니다."
                );


              button.disabled =
                false;


              button.textContent =
                "승인";
            }
          }
        );


      list.appendChild(
        item
      );
    }
  );


  if (
    pendingMembers.length <=
    PAGE_SIZE
  ) {

    pagination.classList.add(
      "hidden"
    );

  } else {

    pagination.classList.remove(
      "hidden"
    );


    document
      .getElementById(
        "channelMemberApprovalSummary"
      )
      .textContent =
        `총 ${pendingMembers.length}명 · ` +
        `${start + 1}-` +
        `${start + items.length}명 표시`;


    document
      .getElementById(
        "channelMemberApprovalPage"
      )
      .textContent =
        `${page} / ${totalPages}`;


    document
      .getElementById(
        "channelMemberApprovalPrev"
      )
      .disabled =
        page <= 1;


    document
      .getElementById(
        "channelMemberApprovalNext"
      )
      .disabled =
        page >= totalPages;
  }
}


/* =========================================================
   승인
========================================================= */

async function approveMember(
  member
) {

  const channelId =
    currentContext.channelId;


  const memberRef =
    doc(
      db,
      "channels",
      channelId,
      "members",
      member.uid
    );


  const mirrorRef =
    doc(
      db,
      "users",
      member.uid,
      "memberships",
      channelId
    );


  const batch =
    writeBatch(
      db
    );


  batch.update(
    memberRef,
    {
      status:
        "approved",

      bingoAccess:
        currentContext.channel
          .bingoEnabled === true

          ? "write"

          : "none",

      killSheetAccess:
        "none",

      joinedAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp()
    }
  );


  batch.update(
    mirrorRef,
    {
      status:
        "approved",

      joinedAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp()
    }
  );


  await batch.commit();
}


/* =========================================================
   실시간 pending 감시
========================================================= */

function startWatcher() {

  if (
    unsubscribe ||
    !isChannelManager(
      currentContext
    )
  ) {
    return;
  }


  unsubscribe =
    onSnapshot(
      collection(
        db,
        "channels",
        currentContext.channelId,
        "members"
      ),

      (snapshot) => {

        pendingMembers =
          snapshot.docs
            .map(
              (item) => ({
                uid:
                  item.id,

                ...item.data(),

                status:
                  normalizeMemberStatus(
                    item.data()
                      .status
                  )
              })
            )
            .filter(
              (member) =>
                member.status ===
                "pending"
            )
            .sort(
              (a, b) =>
                (
                  a.name ||
                  a.email ||
                  ""
                ).localeCompare(
                  b.name ||
                  b.email ||
                  "",
                  "ko"
                )
            );


        setBadge(
          pendingMembers.length
        );


        if (
          !document
            .getElementById(
              "channelMemberApprovalModal"
            )
            ?.classList
            .contains(
              "hidden"
            )
        ) {

          render();
        }
      },

      (error) => {

        console.error(
          "채널 가입 대기 조회 실패",
          error
        );
      }
    );
}


/* =========================================================
   초기화 export
========================================================= */

export function initChannelMemberApproval(
  context
) {

  currentContext =
    context;


  if (
    !isChannelManager(
      currentContext
    )
  ) {
    return;
  }


  const button =
    ensureButton();


  if (
    button &&
    !button.dataset.bound
  ) {

    button.dataset.bound =
      "1";


    button.addEventListener(
      "click",
      openModal
    );
  }


  ensureModal();


  startWatcher();
}