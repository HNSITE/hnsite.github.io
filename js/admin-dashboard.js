import { db } from "./firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showNotice } from "./ui-dialog.js?v=14";
import { firebaseErrorMessage } from "./error-messages.js?v=27";

let currentProfile = null;
let cachedUsers = [];
let cachedRooms = [];

const isManager = () => ["super_admin", "admin", "developer"].includes(currentProfile?.role) && currentProfile?.status === "approved";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function ensureButton() {
  if (!isManager()) return null;
  let button = document.getElementById("adminDashboardButton");
  if (button) return button;
  const nav = document.querySelector(".topbar-user");
  if (!nav) return null;
  button = document.createElement("button");
  button.id = "adminDashboardButton";
  button.className = "topbar-link";
  button.type = "button";
  button.textContent = "관리 현황";
  const email = nav.querySelector(".topbar-email");
  nav.insertBefore(button, email || nav.firstChild);
  return button;
}

function ensureModal() {
  let modal = document.getElementById("adminDashboardModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "adminDashboardModal";
  modal.className = "admin-modal hidden";
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-close-dashboard></div>
    <section class="admin-dashboard-dialog" role="dialog" aria-modal="true" aria-label="관리 현황">
      <div class="admin-modal-header">
        <div><p class="eyebrow">DASHBOARD</p><h2>관리 현황</h2><p class="muted">사용자와 빙고방 운영 현황을 확인합니다.</p></div>
        <button class="modal-close-button" data-close-dashboard type="button">×</button>
      </div>
      <div id="dashboardStats" class="dashboard-stats"></div>
      <div class="dashboard-export-actions">
        <button id="exportUsersCsv" class="secondary" type="button">사용자 CSV</button>
        <button id="exportRoomsCsv" class="secondary" type="button">빙고방 CSV</button>
        <button id="exportChickenCsv" class="secondary" type="button">치킨 기록 CSV</button>
      </div>
      <div class="dashboard-recent-grid">
        <section><h3>최근 관리자 작업</h3><div id="dashboardAdminLogs" class="dashboard-log-list"></div></section>
        <section><h3>최근 빙고방 작업</h3><div id="dashboardRoomLogs" class="dashboard-log-list"></div></section>
      </div>
    </section>`;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close-dashboard]").forEach((el) => el.addEventListener("click", () => closeDashboard()));
  modal.querySelector("#exportUsersCsv").addEventListener("click", () => exportUsers());
  modal.querySelector("#exportRoomsCsv").addEventListener("click", () => exportRooms());
  modal.querySelector("#exportChickenCsv").addEventListener("click", () => exportChicken());
  return modal;
}

function timestampMs(value) { return value?.toMillis?.() || 0; }
function formatTime(value) {
  const date = value?.toDate?.();
  return date ? new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "-";
}

async function loadDashboard() {
  const [usersSnap, roomsSnap, adminSnap, roomLogSnap] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "bingoRooms")),
    getDocs(collection(db, "adminAuditLogs")),
    getDocs(collection(db, "roomAuditLogs"))
  ]);
  cachedUsers = usersSnap.docs.map((item) => ({ uid: item.id, ...item.data() }));
  cachedRooms = roomsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const stats = {
    users: cachedUsers.length,
    pending: cachedUsers.filter((item) => item.status === "pending").length,
    active: cachedRooms.filter((item) => item.status !== "closed").length,
    closed: cachedRooms.filter((item) => item.status === "closed").length,
    today: cachedRooms.filter((item) => timestampMs(item.createdAt) >= startToday).length
  };
  document.getElementById("dashboardStats").innerHTML = `
    <div><span>전체 사용자</span><strong>${stats.users}</strong></div>
    <div><span>승인 대기</span><strong>${stats.pending}</strong></div>
    <div><span>진행 중 방</span><strong>${stats.active}</strong></div>
    <div><span>종료된 방</span><strong>${stats.closed}</strong></div>
    <div><span>오늘 생성</span><strong>${stats.today}</strong></div>`;
  renderLogs("dashboardAdminLogs", adminSnap.docs.map((d) => d.data()), (log) => `${log.actorName || "관리자"} · ${log.action || "작업"} · ${log.targetName || ""}`);
  renderLogs("dashboardRoomLogs", roomLogSnap.docs.map((d) => d.data()), (log) => `${log.actorName || "사용자"} · ${log.action || "작업"} · ${log.roomName || "빙고방"}`);
}

function renderLogs(id, logs, text) {
  const container = document.getElementById(id);
  const sorted = logs.sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt)).slice(0, 10);
  container.innerHTML = sorted.length ? sorted.map((log) => `<div><span>${escapeHtml(formatTime(log.createdAt))}</span><strong>${escapeHtml(text(log))}</strong><small>${escapeHtml(log.detail || "")}</small></div>`).join("") : '<p class="muted">기록이 없습니다.</p>';
}

function csvEscape(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function downloadCsv(name, rows) {
  const csv = "\uFEFF" + rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

function exportUsers() {
  downloadCsv("churang-users.csv", [["이름","이메일","구분","상태","빙고권한","킬내기권한"], ...cachedUsers.map((u) => [u.name,u.email,u.role,u.status,u.bingoAccess,u.killSheetAccess])]);
}
function exportRooms() {
  downloadCsv("churang-bingo-rooms.csv", [["방이름","종류","크기","상태","방장","참가자수","생성일","종료일"], ...cachedRooms.map((r) => [r.name,r.boardType || "number",`${r.size}x${r.size}`,r.status || "active",r.ownerName,(r.participantUids?.length || 0)+1,formatTime(r.createdAt),formatTime(r.closedAt)])]);
}
async function exportChicken() {
  try {
    const rows = [["방이름","방ID","사용자","변경","시간","취소여부"]];
    for (const room of cachedRooms) {
      const snap = await getDocs(collection(db, "bingoRooms", room.id, "chickenLogs"));
      snap.docs.forEach((d) => { const x=d.data(); rows.push([room.name,room.id,x.actorName,x.delta,formatTime(x.createdAt),x.reverted ? "Y" : "N"]); });
    }
    downloadCsv("churang-chicken-logs.csv", rows);
  } catch (error) {
    console.error(error); await showNotice(firebaseErrorMessage(error, "치킨 기록을 내보내지 못했습니다."));
  }
}

async function openDashboard() {
  if (!isManager()) return;
  const modal = ensureModal(); modal.classList.remove("hidden"); document.body.classList.add("modal-open");
  document.getElementById("dashboardStats").innerHTML = '<div class="muted">불러오는 중...</div>';
  try { await loadDashboard(); } catch (error) { console.error(error); document.getElementById("dashboardStats").innerHTML = `<div class="message">${escapeHtml(firebaseErrorMessage(error, "관리 현황을 불러오지 못했습니다."))}</div>`; }
}
function closeDashboard() { document.getElementById("adminDashboardModal")?.classList.add("hidden"); document.body.classList.remove("modal-open"); }

export function initAdminDashboard(profile) {
  currentProfile = profile;
  if (!isManager()) return;
  const button = ensureButton();
  if (button && !button.dataset.bound) { button.dataset.bound = "1"; button.addEventListener("click", openDashboard); }
}
