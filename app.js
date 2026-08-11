import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const loadingPanel = document.getElementById("loadingPanel");
const appContent = document.getElementById("appContent");
const adminPanel = document.getElementById("adminPanel");
const adminMessage = document.getElementById("adminMessage");
let currentProfile = null;

const accessLabel = (value) => ({ none: "권한 없음", read: "읽기", write: "쓰기" }[value] || "권한 없음");
const roleLabel = (value) => ({ super_admin: "최고관리자", admin: "관리자", user: "일반사용자" }[value] || value);
const statusLabel = (value) => ({ pending: "승인대기", approved: "승인", suspended: "사용중지" }[value] || value);
const isManager = () => ["super_admin", "admin"].includes(currentProfile?.role);

async function loadProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) throw new Error("등록되지 않은 계정입니다.");
  const profile = snap.data();
  if (profile.status !== "approved") throw new Error("승인되지 않았거나 사용중지된 계정입니다.");
  return { uid: user.uid, ...profile };
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("./index.html");
    return;
  }

  try {
    currentProfile = await loadProfile(user);
    document.getElementById("userEmail").textContent = user.email || "";
    document.getElementById("roleBadge").textContent = roleLabel(currentProfile.role);
    document.getElementById("welcomeText").textContent = `${currentProfile.name || user.email}님, 로그인되었습니다.`;
    document.getElementById("bingoAccess").textContent = `빙고판: ${isManager() ? "쓰기" : accessLabel(currentProfile.bingoAccess)}`;
    document.getElementById("killAccess").textContent = `킬내기: ${isManager() ? "쓰기" : accessLabel(currentProfile.killSheetAccess)}`;

    loadingPanel.classList.add("hidden");
    appContent.classList.remove("hidden");

    if (isManager()) {
      adminPanel.classList.remove("hidden");
      await loadUsers();
    }
  } catch (error) {
    console.error(error);
    loadingPanel.innerHTML = `<h2>접근할 수 없습니다.</h2><p>${error.message}</p><button id="backLogin">로그인 화면으로</button>`;
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

document.getElementById("refreshUsers").addEventListener("click", loadUsers);

async function loadUsers() {
  adminMessage.textContent = "불러오는 중...";
  try {
    const snap = await getDocs(collection(db, "users"));
    const users = snap.docs.map((item) => ({ uid: item.id, ...item.data() }));
    users.sort((a, b) => {
      const rank = { super_admin: 0, admin: 1, user: 2 };
      return (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || (a.name || "").localeCompare(b.name || "", "ko");
    });
    renderUsers(users);
    adminMessage.textContent = "";
  } catch (error) {
    console.error(error);
    adminMessage.textContent = "사용자 목록을 불러오지 못했습니다.";
  }
}

function makeAccessSelect(user, field, editable) {
  const select = document.createElement("select");
  ["none", "read", "write"].forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = accessLabel(value);
    option.selected = user[field] === value;
    select.appendChild(option);
  });
  select.disabled = !editable;

  if (editable) {
    select.addEventListener("change", async () => {
      try {
        await updateDoc(doc(db, "users", user.uid), { [field]: select.value });
      } catch (error) {
        console.error(error);
        alert("권한 변경에 실패했습니다.");
        await loadUsers();
      }
    });
  }

  return select;
}

function button(text, onClick, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  if (className) element.className = className;
  element.addEventListener("click", onClick);
  return element;
}

function addCell(row, content) {
  const cell = document.createElement("td");
  if (content instanceof Node) cell.appendChild(content);
  else cell.textContent = content;
  row.appendChild(cell);
}

function renderUsers(users) {
  const body = document.getElementById("usersBody");
  body.innerHTML = "";

  users.forEach((user) => {
    const row = document.createElement("tr");
    addCell(row, user.name || "-");
    addCell(row, user.email || "-");
    addCell(row, roleLabel(user.role));
    addCell(row, statusLabel(user.status));

    const editableUser = user.role === "user" && isManager();
    addCell(row, makeAccessSelect(user, "bingoAccess", editableUser));
    addCell(row, makeAccessSelect(user, "killSheetAccess", editableUser));

    const actions = document.createElement("div");
    actions.className = "row-actions";

    if (user.role === "super_admin") {
      actions.textContent = "변경 불가";
    } else if (currentProfile.role === "admin" && user.role !== "user") {
      actions.textContent = "관리자 변경 불가";
    } else if (user.role === "user") {
      if (user.status === "pending") {
        actions.appendChild(button("승인", async () => {
          try {
            await updateDoc(doc(db, "users", user.uid), { status: "approved" });
            await loadUsers();
          } catch (error) {
            console.error(error);
            alert("승인에 실패했습니다.");
          }
        }));
      } else if (user.status === "approved") {
        actions.appendChild(button("사용중지", async () => {
          try {
            await updateDoc(doc(db, "users", user.uid), { status: "suspended" });
            await loadUsers();
          } catch (error) {
            console.error(error);
            alert("사용중지에 실패했습니다.");
          }
        }, "danger"));
      } else if (user.status === "suspended") {
        actions.appendChild(button("사용재개", async () => {
          try {
            await updateDoc(doc(db, "users", user.uid), { status: "approved" });
            await loadUsers();
          } catch (error) {
            console.error(error);
            alert("사용재개에 실패했습니다.");
          }
        }));
      }

      if (currentProfile.role === "super_admin" && user.status === "approved") {
        actions.appendChild(button("관리자로 지정", async () => {
          if (!confirm(`${user.name || user.email} 사용자를 관리자로 지정할까요?`)) return;
          try {
            await updateDoc(doc(db, "users", user.uid), { role: "admin" });
            await loadUsers();
          } catch (error) {
            console.error(error);
            alert("관리자 지정에 실패했습니다.");
          }
        }));
      }
    } else if (user.role === "admin" && currentProfile.role === "super_admin") {
      actions.appendChild(button("일반사용자로 변경", async () => {
        if (!confirm(`${user.name || user.email} 관리자를 일반사용자로 변경할까요?`)) return;
        try {
          await updateDoc(doc(db, "users", user.uid), {
            role: "user",
            bingoAccess: "write",
            killSheetAccess: "write"
          });
          await loadUsers();
        } catch (error) {
          console.error(error);
          alert("관리자 해제에 실패했습니다.");
        }
      }));
    }

    addCell(row, actions);
    body.appendChild(row);
  });
}
