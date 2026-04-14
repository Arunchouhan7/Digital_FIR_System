const loginForm = document.getElementById("adminLogin");
const adminStatus = document.getElementById("adminStatus");
const dashboard = document.getElementById("adminDashboard");
const statsEl = document.getElementById("stats");
const tableBody = document.querySelector("#firTable tbody");
const contactPanel = document.getElementById("contactPanel");
const contactBody = document.querySelector("#contactTable tbody");
const visitChartEl = document.getElementById("visitChart");
const visitMonthEl = document.getElementById("visitMonthChart");
const visitYearEl = document.getElementById("visitYearChart");
const logPanel = document.getElementById("logPanel");
const logBody = document.querySelector("#logTable tbody");
const visitorPanel = document.getElementById("visitorPanel");
const visitorBody = document.querySelector("#visitorTable tbody");
const filterStatus = document.getElementById("filterStatus");
const filterCity = document.getElementById("filterCity");
const filterType = document.getElementById("filterType");
const filterFrom = document.getElementById("filterFrom");
const filterTo = document.getElementById("filterTo");
const filterId = document.getElementById("filterId");
const filterMobile = document.getElementById("filterMobile");
const applyFilters = document.getElementById("applyFilters");
const resetFilters = document.getElementById("resetFilters");
const exportFirs = document.getElementById("exportFirs");
const exportContacts = document.getElementById("exportContacts");
const exportVisitors = document.getElementById("exportVisitors");
const firModal = document.getElementById("firModal");
const firDetails = document.getElementById("firDetails");
const closeModal = document.getElementById("closeModal");
let adminMap;
let visitChart;
let visitMonthChart;
let visitYearChart;

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new URLSearchParams(new FormData(loginForm));
  const res = await fetch("/api/admin/login", {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!data.ok) {
    adminStatus.textContent = data.error || "Login failed";
    return;
  }
  adminStatus.textContent = "Login successful";
  const loginPanel = document.getElementById("adminLoginPanel");
  if (loginPanel) loginPanel.style.display = "none";
  dashboard.style.display = "block";
  loadDashboard();
  startAutoRefresh();
});

function getFilterParams() {
  const params = new URLSearchParams();
  if (filterId && filterId.value) params.set("id", filterId.value);
  if (filterMobile && filterMobile.value) params.set("mobile", filterMobile.value);
  if (filterStatus && filterStatus.value) params.set("status", filterStatus.value);
  if (filterCity && filterCity.value) params.set("city", filterCity.value);
  if (filterType && filterType.value) params.set("type", filterType.value);
  if (filterFrom && filterFrom.value) params.set("from", filterFrom.value);
  if (filterTo && filterTo.value) params.set("to", filterTo.value);
  return params.toString();
}

async function loadDashboard() {
  const [statsRes, firsRes] = await Promise.all([
    fetch("/api/admin/stats"),
    fetch(`/api/admin/firs?${getFilterParams()}`),
  ]);
  const stats = await statsRes.json();
  const firs = await firsRes.json();

  statsEl.innerHTML = `
    <div class="feature"><div class="stat">${stats.total}</div><div class="stat-label">Total FIRs</div></div>
    <div class="feature"><div class="stat">${stats.today}</div><div class="stat-label">Today</div></div>
    <div class="feature"><div class="stat">${stats.cities}</div><div class="stat-label">Cities</div></div>
    <div class="feature"><div class="stat">${stats.visits_today}</div><div class="stat-label">Visits Today</div></div>
    <div class="feature"><div class="stat">${stats.visits_total}</div><div class="stat-label">Total Visits</div></div>
    <div class="feature"><div class="stat">${stats.active_users}</div><div class="stat-label">Active Users (5 min)</div></div>
  `;

  tableBody.innerHTML = "";
  firs.forEach((f) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${f.fir_id}</td>
      <td>${f.full_name}</td>
      <td>${f.incident_type}</td>
      <td>${f.incident_location}</td>
      <td>${f.incident_time}</td>
      <td>${f.geo_city || "-"}</td>
      <td>${f.geo_ip || "-"}</td>
      <td>
        <select class="status-select" data-id="${f.fir_id}">
          <option ${f.status === "Submitted" ? "selected" : ""}>Submitted</option>
          <option ${f.status === "In Review" ? "selected" : ""}>In Review</option>
          <option ${f.status === "Assigned" ? "selected" : ""}>Assigned</option>
          <option ${f.status === "Closed" ? "selected" : ""}>Closed</option>
        </select>
      </td>
      <td><button class="btn small ghost view-fir" data-id="${f.fir_id}">View</button></td>
      <td><button class="btn small pdf-fir" data-id="${f.fir_id}">PDF</button></td>
    `;
    tableBody.appendChild(tr);
  });

  tableBody.querySelectorAll(".view-fir").forEach((btn) => {
    btn.addEventListener("click", () => openFirModal(btn.getAttribute("data-id")));
  });

  tableBody.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const id = e.target.getAttribute("data-id");
      const status = e.target.value;
      await fetch("/api/admin/status", {
        method: "POST",
        body: new URLSearchParams({ id, status }),
      });
    });
  });

  tableBody.querySelectorAll(".pdf-fir").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const res = await fetch(`/api/admin/fir-token/${id}`);
      const data = await res.json();
      if (data && data.pdf_url) window.open(data.pdf_url, "_blank");
    });
  });

  const mapEl = document.getElementById("adminMap");
  if (mapEl) {
    adminMap = L.map(mapEl).setView([22.5, 78.9], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(adminMap);
    firs.forEach((f) => {
      if (f.geo_lat && f.geo_lng) {
        L.marker([f.geo_lat, f.geo_lng]).addTo(adminMap).bindPopup(`${f.full_name} - ${f.incident_type}`);
      }
    });
  }

  loadContacts();
  loadVisitChart();
  loadVisitMonthChart();
  loadVisitYearChart();
  loadLogs();
  loadVisitors();
}

async function loadContacts() {
  if (!contactBody) return;
  const res = await fetch("/api/admin/contacts");
  const items = await res.json();
  contactBody.innerHTML = "";
  items.forEach((c) => {
    const tr = document.createElement("tr");
    const attachment = c.attachment_path ? `<a href="../${c.attachment_path}" target="_blank">View</a>` : "-";
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${c.full_name}</td>
      <td>${c.email}</td>
      <td>${c.mobile}</td>
      <td>${c.category}</td>
      <td>${c.message}</td>
      <td>${attachment}</td>
      <td>${c.created_at}</td>
    `;
    contactBody.appendChild(tr);
  });
  if (contactPanel) contactPanel.style.display = "block";
}

async function loadVisitors() {
  if (!visitorBody) return;
  const res = await fetch("/api/admin/visitors");
  const rows = await res.json();
  visitorBody.innerHTML = "";
  rows.forEach((v) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${v.ip || "-"}</td>
      <td>${v.city || "-"}</td>
      <td>${v.region || "-"}</td>
      <td>${v.country || "-"}</td>
      <td>${v.page || "-"}</td>
      <td>${v.created_at}</td>
    `;
    visitorBody.appendChild(tr);
  });
  if (visitorPanel) visitorPanel.style.display = "block";
}

async function loadLogs() {
  if (!logBody) return;
  const res = await fetch("/api/admin/logs");
  const items = await res.json();
  logBody.innerHTML = "";
  items.forEach((l) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${l.id}</td>
      <td>${l.action}</td>
      <td>${l.details}</td>
      <td>${l.created_at}</td>
    `;
    logBody.appendChild(tr);
  });
  if (logPanel) logPanel.style.display = "block";
}

async function openFirModal(id) {
  const res = await fetch(`/api/fir/${id}`);
  const data = await res.json();
  if (!data.ok) return;
  const f = data.fir;
  firDetails.innerHTML = `
    <div class="modal-row"><strong>ID</strong><span>${f.id}</span></div>
    <div class="modal-row"><strong>Name</strong><span>${f.full_name}</span></div>
    <div class="modal-row"><strong>Mobile</strong><span>${f.mobile}</span></div>
    <div class="modal-row"><strong>Aadhaar</strong><span>${f.aadhaar}</span></div>
    <div class="modal-row"><strong>Type</strong><span>${f.incident_type}</span></div>
    <div class="modal-row"><strong>Location</strong><span>${f.incident_location}</span></div>
    <div class="modal-row"><strong>Time</strong><span>${f.incident_time}</span></div>
    <div class="modal-row"><strong>Status</strong><span>${f.status || "Submitted"}</span></div>
    <div class="modal-row"><strong>Geo</strong><span>${f.geo_city || "-"}, ${f.geo_region || "-"}</span></div>
    <div class="modal-row"><strong>IP</strong><span>${f.geo_ip || "-"}</span></div>
    <div class="modal-row"><strong>Complaint</strong><span>${f.complaint || "-"}</span></div>
    <div class="modal-row"><strong>OCR Text</strong><span>${f.ocr_text || "-"}</span></div>
    ${f.signature ? `<div class="modal-row"><strong>Signature</strong><span><img src="${f.signature}" alt="Signature" style="max-width:220px;border:1px solid #e2e8f0;border-radius:8px;"/></span></div>` : ""}
  `;
  firModal.style.display = "flex";
}

if (closeModal) closeModal.addEventListener("click", () => (firModal.style.display = "none"));
if (firModal) firModal.addEventListener("click", (e) => {
  if (e.target === firModal) firModal.style.display = "none";
});

if (applyFilters) applyFilters.addEventListener("click", () => loadDashboard());
if (resetFilters) resetFilters.addEventListener("click", () => {
  if (filterId) filterId.value = "";
  if (filterMobile) filterMobile.value = "";
  if (filterStatus) filterStatus.value = "";
  if (filterCity) filterCity.value = "";
  if (filterType) filterType.value = "";
  if (filterFrom) filterFrom.value = "";
  if (filterTo) filterTo.value = "";
  loadDashboard();
});

if (exportFirs) exportFirs.addEventListener("click", () => {
  window.location.href = `/api/admin/export/firs?${getFilterParams()}`;
});
if (exportContacts) exportContacts.addEventListener("click", () => {
  window.location.href = "/api/admin/export/contacts";
});
if (exportVisitors) exportVisitors.addEventListener("click", () => {
  window.location.href = "/api/admin/export/visitors";
});

function startAutoRefresh() {
  setInterval(() => {
    loadDashboard();
  }, 15000);
}
async function loadVisitChart() {
  if (!visitChartEl || !window.Chart) return;
  const res = await fetch("/api/admin/visits");
  const data = await res.json();
  const cfg = {
    type: "line",
    data: {
      labels: data.labels,
      datasets: [{
        label: "Daily Visits",
        data: data.counts,
        borderColor: "#f97316",
        backgroundColor: "rgba(249,115,22,0.2)",
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  };
  if (visitChart) {
    visitChart.data = cfg.data;
    visitChart.update();
  } else {
    visitChart = new Chart(visitChartEl, cfg);
  }
}

async function loadVisitMonthChart() {
  if (!visitMonthEl || !window.Chart) return;
  const res = await fetch("/api/admin/visits/monthly");
  const data = await res.json();
  const cfg = {
    type: "bar",
    data: {
      labels: data.labels,
      datasets: [{
        label: "Monthly",
        data: data.counts,
        backgroundColor: "rgba(14,165,233,0.4)",
        borderColor: "#0ea5e9",
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  };
  if (visitMonthChart) {
    visitMonthChart.data = cfg.data;
    visitMonthChart.update();
  } else {
    visitMonthChart = new Chart(visitMonthEl, cfg);
  }
}

async function loadVisitYearChart() {
  if (!visitYearEl || !window.Chart) return;
  const res = await fetch("/api/admin/visits/yearly");
  const data = await res.json();
  const cfg = {
    type: "bar",
    data: {
      labels: data.labels,
      datasets: [{
        label: "Yearly",
        data: data.counts,
        backgroundColor: "rgba(249,115,22,0.35)",
        borderColor: "#f97316",
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  };
  if (visitYearChart) {
    visitYearChart.data = cfg.data;
    visitYearChart.update();
  } else {
    visitYearChart = new Chart(visitYearEl, cfg);
  }
}
