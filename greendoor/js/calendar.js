import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getCurrentUser, formatDateTime, showToast } from "./auth.js";

let currentView = "week";
let currentDate = new Date();
let allCalEvents = []; // merged showings + followUps + events
let allClients = {};
let editingEventId = null;
let draggingEventId = null;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    await loadCalendarData(user.uid);
  } catch (e) {
    console.error("Failed to load calendar data:", e);
    showToast("Failed to load some calendar data.", "error");
  }
  document.getElementById("calendar-loading").classList.add("gd-hidden");
  document.getElementById("calendar-content").classList.remove("gd-hidden");
  render();
});

async function loadCalendarData(uid) {
  // Load all clients for name lookup
  try {
    const clientsSnap = await getDocs(query(collection(db, "clients"), where("realtorId", "==", uid)));
    clientsSnap.forEach(d => { allClients[d.id] = d.data(); });
  } catch (e) {
    console.error("Load clients for calendar:", e);
  }

  // Load showings, follow-ups, and custom events
  const [showingsSnap, followUpsSnap, eventsSnap] = await Promise.all([
    getDocs(query(collection(db, "showings"), where("realtorId", "==", uid), orderBy("showingDate", "asc"))).catch(e => { console.error("Load showings:", e); return { forEach() {} }; }),
    getDocs(query(collection(db, "followUps"), where("realtorId", "==", uid), orderBy("dueDate", "asc"))).catch(e => { console.error("Load follow-ups:", e); return { forEach() {} }; }),
    getDocs(query(collection(db, "events"), where("realtorId", "==", uid), orderBy("startDate", "asc"))).catch(e => { console.error("Load events:", e); return { forEach() {} }; })
  ]);

  allCalEvents = [];

  showingsSnap.forEach(d => {
    const s = d.data();
    if (s.status === "cancelled") return;
    const start = s.showingDate?.toDate ? s.showingDate.toDate() : new Date();
    allCalEvents.push({
      id: d.id, type: "showing",
      title: s.address || "Showing",
      start,
      end: s.endDate?.toDate ? s.endDate.toDate() : new Date(start.getTime() + 3600000),
      clientId: s.clientId,
      color: "#22c55e",
      data: s
    });
  });

  followUpsSnap.forEach(d => {
    const f = d.data();
    if (f.status === "completed" || f.status === "dismissed") return;
    const due = f.dueDate?.toDate ? f.dueDate.toDate() : new Date();
    allCalEvents.push({
      id: d.id, type: "followup",
      title: f.title || "Follow-up",
      start: due,
      end: new Date(due.getTime() + 1800000),
      clientId: f.clientId,
      color: "#f59e0b",
      data: f
    });
  });

  eventsSnap.forEach(d => {
    const e = d.data();
    allCalEvents.push({
      id: d.id, type: "event",
      title: e.title || "Event",
      start: e.startDate?.toDate ? e.startDate.toDate() : new Date(),
      end: e.endDate?.toDate ? e.endDate.toDate() : new Date(),
      allDay: e.allDay || false,
      clientId: e.clientId || null,
      color: e.color || "#3b82f6",
      data: e
    });
  });

  // Populate client dropdown in event modal
  const select = document.getElementById("ev-client");
  select.innerHTML = '<option value="">— None —</option>';
  Object.entries(allClients).forEach(([id, c]) => {
    select.innerHTML += `<option value="${id}">${c.fullName}</option>`;
  });
}

function render() {
  const titleEl = document.getElementById("cal-title");

  if (currentView === "month") {
    titleEl.textContent = `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    renderMonth();
  } else {
    const weekStart = getWeekStart(currentDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    titleEl.textContent = `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} — ${weekEnd.getDate()}, ${weekStart.getFullYear()}`;
    renderWeek();
  }
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function renderMonth() {
  const grid = document.getElementById("cal-grid");
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const today = new Date();

  let html = '<div class="gd-cal-month">';

  // Day of week headers
  DAYS.forEach(d => { html += `<div class="gd-cal-dow">${d}</div>`; });

  // Previous month filler
  const prevMonth = new Date(year, month, 0);
  for (let i = startOffset - 1; i >= 0; i--) {
    const day = prevMonth.getDate() - i;
    html += `<div class="gd-cal-day other-month"><div class="gd-cal-day-num">${day}</div></div>`;
  }

  // Current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    const isToday = sameDay(date, today);
    const dayEvents = allCalEvents.filter(e => sameDay(e.start, date));
    const maxShow = 3;

    html += `<div class="gd-cal-day${isToday ? " today" : ""}" data-date="${year}-${month}-${d}" onclick="onDayClick(${year},${month},${d})" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="event.preventDefault();this.classList.remove('drag-over');dropOnDay(${year},${month},${d})">`;
    html += `<div class="gd-cal-day-num">${d}</div>`;
    html += '<div class="gd-cal-day-events">';

    dayEvents.slice(0, maxShow).forEach(ev => {
      const clickHandler = ev.type === "event"
        ? `event.stopPropagation();editEvent('${ev.id}')`
        : `event.stopPropagation();showPopover('${ev.id}',this)`;
      html += `<div class="gd-cal-event-dot ${ev.type}" draggable="true" ondragstart="onEventDragStart(event,'${ev.id}')" onclick="${clickHandler}">${ev.title}</div>`;
    });

    if (dayEvents.length > maxShow) {
      html += `<div class="gd-cal-more">+${dayEvents.length - maxShow} more</div>`;
    }

    html += '</div></div>';
  }

  // Next month filler
  const totalCells = startOffset + lastDay.getDate();
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="gd-cal-day other-month"><div class="gd-cal-day-num">${i}</div></div>`;
  }

  html += '</div>';
  grid.innerHTML = html;
}

function renderWeek() {
  const grid = document.getElementById("cal-grid");
  const weekStart = getWeekStart(currentDate);
  const today = new Date();
  const startHour = 7;
  const endHour = 21;

  let html = '<div class="gd-cal-week">';

  // Header row
  html += '<div class="gd-cal-week-corner"></div>';
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const isToday = sameDay(d, today);
    html += `<div class="gd-cal-week-day-header${isToday ? " today" : ""}">${DAYS[i]}<br>${d.getDate()}</div>`;
  }

  // Time grid
  for (let h = startHour; h < endHour; h++) {
    const label = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
    html += `<div class="gd-cal-week-time">${label}</div>`;
    for (let i = 0; i < 7; i++) {
      const cellDate = new Date(weekStart);
      cellDate.setDate(cellDate.getDate() + i);
      html += `<div class="gd-cal-week-cell" data-day="${i}" data-hour="${h}" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="event.preventDefault();this.classList.remove('drag-over');dropOnWeekCell(${cellDate.getFullYear()},${cellDate.getMonth()},${cellDate.getDate()},${h})"></div>`;
    }
  }

  html += '</div>';
  grid.innerHTML = html;

  // Place events
  const weekGrid = grid.querySelector(".gd-cal-week");
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStart);
    dayDate.setDate(dayDate.getDate() + i);

    const dayEvents = allCalEvents.filter(e => sameDay(e.start, dayDate));
    dayEvents.forEach(ev => {
      const startH = ev.start.getHours() + ev.start.getMinutes() / 60;
      const endH = ev.end.getHours() + ev.end.getMinutes() / 60;
      if (startH < startHour || startH >= endHour) return;

      const top = (startH - startHour) * 48;
      const height = Math.max((endH - startH) * 48, 20);
      const col = i + 2; // +2 because col 1 is time
      const row = Math.floor(startH - startHour) + 2; // +2 for header

      const cell = weekGrid.querySelector(`.gd-cal-week-cell[data-day="${i}"][data-hour="${Math.floor(startH)}"]`);
      if (cell) {
        const evEl = document.createElement("div");
        evEl.className = `gd-cal-week-event ${ev.type}`;
        evEl.style.top = (startH % 1) * 48 + "px";
        evEl.style.height = height + "px";
        evEl.style.background = ev.color;
        evEl.textContent = ev.title;
        evEl.draggable = true;
        evEl.addEventListener("dragstart", (e) => { onEventDragStart(e, ev.id); });
        evEl.onclick = (e) => {
          e.stopPropagation();
          if (ev.type === "event") { editEvent(ev.id); } else { showPopover(ev.id, evEl); }
        };
        cell.appendChild(evEl);
      }
    });
  }

  // Current time indicator
  if (sameDay(today, weekStart) || (today >= weekStart && today < new Date(weekStart.getTime() + 7 * 86400000))) {
    const nowH = today.getHours() + today.getMinutes() / 60;
    if (nowH >= startHour && nowH < endHour) {
      const topPx = (nowH - startHour) * 48 + 37; // 37px for header row height
      const line = document.createElement("div");
      line.className = "gd-cal-now-line";
      line.style.top = topPx + "px";
      weekGrid.appendChild(line);
    }
  }
}

// Navigation
window.calPrev = function () {
  if (currentView === "month") {
    currentDate.setMonth(currentDate.getMonth() - 1);
  } else {
    currentDate.setDate(currentDate.getDate() - 7);
  }
  render();
};

window.calNext = function () {
  if (currentView === "month") {
    currentDate.setMonth(currentDate.getMonth() + 1);
  } else {
    currentDate.setDate(currentDate.getDate() + 7);
  }
  render();
};

window.calToday = function () {
  currentDate = new Date();
  render();
};

window.setCalView = function (view) {
  currentView = view;
  document.querySelectorAll(".gd-calendar-view-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  render();
};

// Popover
window.showPopover = function (eventId, anchorEl) {
  const ev = allCalEvents.find(e => e.id === eventId);
  if (!ev) return;

  const pop = document.getElementById("cal-popover");
  document.getElementById("pop-title").textContent = ev.title;

  const clientName = ev.clientId && allClients[ev.clientId] ? allClients[ev.clientId].fullName : "";
  let meta = formatDateTime(Timestamp.fromDate(ev.start));
  if (clientName) meta += `<br>Client: ${clientName}`;
  document.getElementById("pop-meta").innerHTML = meta;

  let actions = "";
  if (ev.clientId) {
    actions += `<a href="/greendoor/app/client-detail?id=${ev.clientId}" class="gd-btn gd-btn-sm gd-btn-primary">View Client</a>`;
  }
  if (ev.type === "event") {
    actions += `<button class="gd-btn gd-btn-sm" onclick="editEvent('${ev.id}')">Edit</button>`;
    actions += `<button class="gd-btn gd-btn-sm" onclick="deleteEvent('${ev.id}')">Delete</button>`;
  }
  document.getElementById("pop-actions").innerHTML = actions;

  // Position popover near anchor
  const rect = anchorEl.getBoundingClientRect();
  pop.style.top = (rect.bottom + window.scrollY + 8) + "px";
  pop.style.left = Math.min(rect.left, window.innerWidth - 280) + "px";
  pop.classList.remove("gd-hidden");
};

window.closePopover = function () {
  document.getElementById("cal-popover").classList.add("gd-hidden");
};

window.onDayClick = function (year, month, day) {
  closePopover();
  const d = new Date(year, month, day, 10, 0);
  openEventModal(null, d);
};

// Close popover on outside click
document.addEventListener("click", (e) => {
  const pop = document.getElementById("cal-popover");
  if (!pop.classList.contains("gd-hidden") && !pop.contains(e.target) && !e.target.closest(".gd-cal-event-dot,.gd-cal-week-event")) {
    closePopover();
  }
});

// Event Modal
window.openEventModal = function (eventId, prefillDate) {
  editingEventId = eventId || null;
  document.getElementById("event-modal-title").textContent = eventId ? "Edit Event" : "Add Event";

  if (eventId) {
    const ev = allCalEvents.find(e => e.id === eventId);
    if (ev && ev.type === "event") {
      document.getElementById("ev-title").value = ev.data.title || "";
      document.getElementById("ev-description").value = ev.data.description || "";
      document.getElementById("ev-allday").checked = ev.data.allDay || false;
      document.getElementById("ev-color").value = ev.data.color || "#3b82f6";
      document.getElementById("ev-client").value = ev.data.clientId || "";
      const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById("ev-start").value = toLocal(ev.start);
      document.getElementById("ev-end").value = toLocal(ev.end);
    }
  } else {
    document.getElementById("ev-title").value = "";
    document.getElementById("ev-description").value = "";
    document.getElementById("ev-allday").checked = false;
    document.getElementById("ev-color").value = "#3b82f6";
    document.getElementById("ev-client").value = "";
    if (prefillDate) {
      const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById("ev-start").value = toLocal(prefillDate);
      const endDate = new Date(prefillDate.getTime() + 3600000);
      document.getElementById("ev-end").value = toLocal(endDate);
    } else {
      document.getElementById("ev-start").value = "";
      document.getElementById("ev-end").value = "";
    }
  }

  closePopover();
  document.getElementById("event-modal").classList.add("active");
};

window.closeEventModal = function () {
  document.getElementById("event-modal").classList.remove("active");
};

window.saveEvent = async function () {
  const user = auth.currentUser;
  if (!user) return;

  const title = document.getElementById("ev-title").value.trim();
  const startVal = document.getElementById("ev-start").value;
  if (!title || !startVal) { showToast("Title and start time are required.", "error"); return; }

  const startDate = new Date(startVal);
  const endVal = document.getElementById("ev-end").value;
  const endDate = endVal ? new Date(endVal) : new Date(startDate.getTime() + 3600000);

  const data = {
    realtorId: user.uid,
    title,
    description: document.getElementById("ev-description").value.trim(),
    startDate: Timestamp.fromDate(startDate),
    endDate: Timestamp.fromDate(endDate),
    allDay: document.getElementById("ev-allday").checked,
    color: document.getElementById("ev-color").value,
    clientId: document.getElementById("ev-client").value || null
  };

  try {
    if (editingEventId) {
      await updateDoc(doc(db, "events", editingEventId), data);
      showToast("Event updated!");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "events"), data);
      showToast("Event created!");
    }
    closeEventModal();
    await loadCalendarData(user.uid);
    render();
  } catch (e) {
    console.error("Save event error:", e);
    showToast("Failed to save event.", "error");
  }
};

window.editEvent = function (id) {
  openEventModal(id);
};

window.deleteEvent = async function (id) {
  if (!confirm("Delete this event?")) return;
  const user = auth.currentUser;
  if (!user) return;

  try {
    await deleteDoc(doc(db, "events", id));
    showToast("Event deleted.");
    closePopover();
    await loadCalendarData(user.uid);
    render();
  } catch (e) {
    console.error("Delete event error:", e);
    showToast("Failed to delete event.", "error");
  }
};

// Drag and drop
window.onEventDragStart = function (e, eventId) {
  draggingEventId = eventId;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", eventId);
  // Add a slight delay so the drag image renders
  setTimeout(() => {
    e.target.style.opacity = "0.5";
  }, 0);
};

window.dropOnDay = async function (year, month, day) {
  if (!draggingEventId) return;
  const ev = allCalEvents.find(e => e.id === draggingEventId);
  if (!ev) return;

  const newDate = new Date(year, month, day, ev.start.getHours(), ev.start.getMinutes());
  await moveEvent(ev, newDate);
  draggingEventId = null;
};

window.dropOnWeekCell = async function (year, month, day, hour) {
  if (!draggingEventId) return;
  const ev = allCalEvents.find(e => e.id === draggingEventId);
  if (!ev) return;

  const newDate = new Date(year, month, day, hour, ev.start.getMinutes());
  await moveEvent(ev, newDate);
  draggingEventId = null;
};

async function moveEvent(ev, newStart) {
  const user = auth.currentUser;
  if (!user) return;

  const diff = newStart.getTime() - ev.start.getTime();
  if (diff === 0) return;

  const newEnd = new Date(ev.end.getTime() + diff);

  try {
    if (ev.type === "event") {
      await updateDoc(doc(db, "events", ev.id), {
        startDate: Timestamp.fromDate(newStart),
        endDate: Timestamp.fromDate(newEnd)
      });
    } else if (ev.type === "showing") {
      await updateDoc(doc(db, "showings", ev.id), {
        showingDate: Timestamp.fromDate(newStart),
        endDate: Timestamp.fromDate(newEnd),
        updatedAt: serverTimestamp()
      });
    } else if (ev.type === "followup") {
      await updateDoc(doc(db, "followUps", ev.id), {
        dueDate: Timestamp.fromDate(newStart)
      });
    }

    // Update locally for instant feedback
    ev.start = newStart;
    ev.end = newEnd;
    render();
    showToast("Event moved!");
  } catch (e) {
    console.error("Move event error:", e);
    showToast("Failed to move event.", "error");
  }
}

// Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (document.getElementById("event-modal").classList.contains("active")) {
      closeEventModal();
    } else {
      closePopover();
    }
  }
});
