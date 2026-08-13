import {
  auth
} from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  initAdminDashboard
} from "./admin-dashboard.js?v=34";

import {
  initChannelMemberApproval
} from "./channel-members.js?v=34";

import {
  initDeveloperChannelTools
} from "./developer-channel-tools.js?v=34";

import {
  showNotice
} from "./ui-dialog.js?v=34";

import {
  firebaseErrorMessage
} from "./error-messages.js?v=34";

import {
  accessLabel,
  displayRole,
  isDeveloper,
  isMemberPending,
  loadCurrentChannelContext,
  loadPlatformProfile,
  resolvedFeatureAccess
} from "./channel-context.js?v=34";


const loadingPanel =
  document.getElementById(
    "loadingPanel"
  );

const appContent =
  document.getElementById(
    "appContent"
  );


function applyServiceAccess(
  context,
  feature,
  textId,
  buttonId,
  cardId
) {

  const access =
    resolvedFeatureAccess(
      context,
      feature
    );


  const text =
    document.getElementById(
      textId
    );


  const button =
    document.getElementById(
      buttonId
    );


  const card =
    document.getElementById(
      cardId
    );


  text.textContent =
    feature === "kill" &&
    context.channel
      .killEnabled !== true

      ? "준비중"

      : accessLabel(
          access
        );


  card.dataset.access =
    access;


  if (
    access === "none"
  ) {

    button.textContent =
      feature === "kill"
        ? "준비중"
        : "접근 권한 없음";


    button.classList.add(
      "disabled"
    );


    button.setAttribute(
      "aria-disabled",
      "true"
    );


    return;
  }


  button.classList.remove(
    "disabled"
  );


  button.removeAttribute(
    "aria-disabled"
  );


  button.textContent =
    access === "read"
      ? "보기"
      : "들어가기";
}


/* =========================================================
   채널 승인 대기 화면
========================================================= */

function renderPendingChannel(
  context,
  profile,
  user
) {

  document
    .getElementById(
      "userEmail"
    )
    .textContent =
      user.email ||
      "";


  document
    .getElementById(
      "currentChannelName"
    )
    .textContent =
      context.channel.name ||
      "HNSITE";


  const roleBadge =
    document.getElementById(
      "roleBadge"
    );


  roleBadge.textContent =
    "승인 대기";


  roleBadge.dataset.role =
    "pending";


  loadingPanel.innerHTML = `
    <p class="eyebrow">
      CHANNEL APPROVAL
    </p>

    <h2>
      채널 가입 승인 대기중입니다.
    </h2>

    <p class="muted">
      ${
        profile.name ||
        user.displayName ||
        "사용자"
      }님의
      ${
        context.channel.name ||
        "채널"
      }
      가입 신청이 접수되었습니다.
      <br />
      채널 소유자 또는 관리자가 승인하면 이용할 수 있습니다.
    </p>

    <a
      class="secondary-link-button inline-button"
      href="./channels.html"
    >
      채널 선택으로 돌아가기
    </a>
  `;
}


/* =========================================================
   초기화
========================================================= */

onAuthStateChanged(
  auth,
  async (
    user
  ) => {

    if (!user) {

      location.replace(
        "./index.html"
      );


      return;
    }


    try {

      const profile =
        await loadPlatformProfile(
          user
        );


      const context =
        await loadCurrentChannelContext(
          user,
          profile
        );


      await initDeveloperChannelTools(
        user,
        profile
      );


      /*
       * 일반 사용자의 pending 상태
       */
      if (
        !isDeveloper(
          profile
        ) &&
        isMemberPending(
          context.member
        )
      ) {

        renderPendingChannel(
          context,
          profile,
          user
        );


        return;
      }


      document
        .getElementById(
          "userEmail"
        )
        .textContent =
          user.email ||
          "";


      document
        .getElementById(
          "currentChannelName"
        )
        .textContent =
          context.channel.name ||
          "HNSITE";


      const roleBadge =
        document.getElementById(
          "roleBadge"
        );


      roleBadge.textContent =
        displayRole(
          context
        );


      roleBadge.dataset.role =
        isDeveloper(
          profile
        )

          ? "developer"

          : context.member.role;


      document
        .getElementById(
          "welcomeText"
        )
        .textContent =
          `${
            profile.name ||
            user.displayName ||
            "사용자"
          }님, ${
            context.channel.name ||
            "채널"
          }에 접속했습니다.`;


      /*
       * 채널 현황
       */
      initAdminDashboard(
        profile,
        context
      );


      /*
       * owner/admin/developer
       * 채널 가입 승인
       */
      initChannelMemberApproval(
        context
      );


      applyServiceAccess(
        context,
        "bingo",
        "bingoAccess",
        "bingoButton",
        "bingoCard"
      );


      applyServiceAccess(
        context,
        "kill",
        "killAccess",
        "killButton",
        "killCard"
      );


      loadingPanel
        .classList
        .add("hidden");


      appContent
        .classList
        .remove("hidden");

    } catch (error) {

      console.error(
        error
      );


      if (
        [
          "NO_CHANNEL",
          "CHANNEL_NOT_FOUND",
          "CHANNEL_INACTIVE"
        ].includes(
          error.code
        )
      ) {

        location.replace(
          "./channels.html"
        );


        return;
      }


      loadingPanel.innerHTML = `
        <h2>
          접근할 수 없습니다.
        </h2>

        <p>
          ${firebaseErrorMessage(
            error,
            error.message ||
            "접근할 수 없습니다."
          )}
        </p>

        <button
          id="backLogin"
          type="button"
        >
          로그인 화면으로
        </button>
      `;


      document
        .getElementById(
          "backLogin"
        )
        .addEventListener(
          "click",
          async () => {

            await signOut(
              auth
            );


            location.replace(
              "./index.html"
            );
          }
        );
    }
  }
);


/* =========================================================
   로그아웃
========================================================= */

document
  .getElementById(
    "logoutButton"
  )
  .addEventListener(
    "click",
    async () => {

      await signOut(
        auth
      );


      location.replace(
        "./index.html"
      );
    }
  );


/* =========================================================
   킬내기
========================================================= */

document
  .getElementById(
    "killButton"
  )
  .addEventListener(
    "click",
    (
      event
    ) => {

      event.preventDefault();


      showNotice(
        "현재 킬내기 기능을 준비하고 있습니다.",
        "준비중입니다"
      );
    }
  );