const form = document.getElementById("firForm");
const statusEl = document.getElementById("firStatus");
const sendOtpBtn = document.getElementById("sendOtp");
const defaultSendOtpText = sendOtpBtn ? (sendOtpBtn.textContent || "").trim() || "Send OTP" : "Send OTP";
let sendOtpIdleText = defaultSendOtpText;
const verifyOtpBtn = document.getElementById("verifyOtp");
const otpValueEl = document.getElementById("otpValue");
const otpTimerEl = document.getElementById("otpTimer");
const otpMsgEl = document.getElementById("otpMsg");
const otpIdInput = document.getElementById("otpId");
const sigCanvas = document.getElementById("sigCanvas");
const sigClear = document.getElementById("sigClear");
const sigSave = document.getElementById("sigSave");
const sigData = document.getElementById("sigData");
const defaultSigSaveText = "Use Signature";
const ocrHidden = document.getElementById("ocrTextHidden");
const firActions = document.getElementById("firActions");
const downloadPdf = document.getElementById("downloadPdf");
const printFir = document.getElementById("printFir");
const trackForm = document.getElementById("trackForm");
const trackIdInput = document.getElementById("trackId");
const trackResult = document.getElementById("trackResult");

let drawing = false;
let lastPos = { x: 0, y: 0 };
let otpTimer;
let otpSeconds = 0;
let otpVerified = false;
let lastFirData = null;
let lastFirUrls = null;

function isValidMobile(value) {
  return /^\d{10}$/.test(String(value || "").trim());
}

function isValidAadhaar(value) {
  return /^\d{12}$/.test(String(value || "").trim());
}

function isValidFullName(value) {
  return String(value || "").trim().length >= 5;
}

function setOtpMessage(message, type = "info") {
  if (!otpMsgEl) return;
  otpMsgEl.textContent = message || "";
  otpMsgEl.classList.remove("otp-message-success", "otp-message-error");
  if (type === "success") otpMsgEl.classList.add("otp-message-success");
  if (type === "error") otpMsgEl.classList.add("otp-message-error");
}

function setOtpUiVisible(visible) {
  if (!form) return;
  const otpInput = form.querySelector('input[name="otp"]');
  if (otpInput) otpInput.style.display = visible ? "" : "none";
  if (sendOtpBtn) sendOtpBtn.style.display = visible ? "" : "none";
  if (verifyOtpBtn) verifyOtpBtn.style.display = visible ? "" : "none";
}

function resetOtpVerification(message) {
  otpVerified = false;
  if (otpIdInput) otpIdInput.value = "";
  if (otpValueEl) otpValueEl.textContent = "----";
  setOtpMessage(message || "", "info");
  if (verifyOtpBtn) verifyOtpBtn.disabled = true;
  setOtpUiVisible(true);
}

function setSendOtpSendingState(isSending) {
  if (!sendOtpBtn) return;
  sendOtpBtn.classList.toggle("sending", !!isSending);
  sendOtpBtn.textContent = isSending ? "sending..." : sendOtpIdleText;
}

if (form) {
  const emailInput = form.querySelector('input[name="email"]');
  const mobileInput = form.querySelector('input[name="mobile"]');
  const aadhaarInput = form.querySelector('input[name="aadhaar"]');
  const otpInput = form.querySelector('input[name="otp"]');

  if (emailInput) {
    emailInput.addEventListener("input", () => {
      if (otpVerified || (otpIdInput && otpIdInput.value)) {
        resetOtpVerification("Email changed. Send OTP again.");
      }
    });
  }

  if (mobileInput) {
    mobileInput.addEventListener("input", () => {
      mobileInput.value = mobileInput.value.replace(/\D/g, "").slice(0, 10);
    });
    mobileInput.addEventListener("input", () => {
      if (otpVerified || (otpIdInput && otpIdInput.value)) {
        resetOtpVerification("Mobile changed. Send OTP again.");
      }
    });
  }

  if (aadhaarInput) {
    aadhaarInput.addEventListener("input", () => {
      aadhaarInput.value = aadhaarInput.value.replace(/\D/g, "").slice(0, 12);
    });
  }

  if (otpInput) {
    otpInput.addEventListener("input", () => {
      if (otpVerified) {
        otpVerified = false;
        if (otpValueEl) otpValueEl.textContent = "----";
        if (otpMsgEl) otpMsgEl.textContent = "OTP changed. Verify again.";
      }
    });
  }
}

if (sendOtpBtn) {
  sendOtpBtn.addEventListener("click", async () => {
    const emailInput = form?.querySelector('input[name="email"]');
    const mobileInput = form?.querySelector('input[name="mobile"]');
    const email = emailInput ? emailInput.value.trim() : "";
    const mobile = mobileInput ? mobileInput.value.trim() : "";

    if (!email) {
      setOtpMessage("Enter email first.", "error");
      return;
    }
    if (!isValidMobile(mobile)) {
      setOtpMessage("Mobile number must be exactly 10 digits.", "error");
      return;
    }

    setOtpUiVisible(true);
    sendOtpBtn.disabled = true;
    setSendOtpSendingState(true);
    setOtpMessage("Sending OTP...", "info");
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, mobile }),
      });
      const data = await res.json();
      if (!data.ok) {
        setOtpMessage(data.error || "OTP send failed.", "error");
        setSendOtpSendingState(false);
        sendOtpBtn.disabled = false;
        if (verifyOtpBtn) verifyOtpBtn.disabled = true;
        return;
      }

      otpVerified = false;
      if (otpIdInput) otpIdInput.value = data.otp_id || "";
      if (otpValueEl) otpValueEl.textContent = "----";
      sendOtpIdleText = "Resend";
      setOtpMessage("OTP sent successfully to your email.", "info");
      setSendOtpSendingState(false);
      if (verifyOtpBtn) verifyOtpBtn.disabled = false;
      startOtpCooldown();
    } catch (e) {
      setOtpMessage("OTP send failed.", "error");
      setSendOtpSendingState(false);
      sendOtpBtn.disabled = false;
      if (verifyOtpBtn) verifyOtpBtn.disabled = true;
    }
  });
}

if (verifyOtpBtn) {
  verifyOtpBtn.disabled = true;
  verifyOtpBtn.addEventListener("click", async () => {
    const emailInput = form?.querySelector('input[name="email"]');
    const mobileInput = form?.querySelector('input[name="mobile"]');
    const otpInput = form?.querySelector('input[name="otp"]');

    const email = emailInput ? emailInput.value.trim() : "";
    const mobile = mobileInput ? mobileInput.value.trim() : "";
    const otp = otpInput ? otpInput.value.trim() : "";
    const otpId = otpIdInput ? otpIdInput.value : "";

    if (!email || !otp || !otpId) {
      setOtpMessage("Enter email, OTP and send OTP first.", "error");
      return;
    }
    if (!isValidMobile(mobile)) {
      setOtpMessage("Mobile number must be exactly 10 digits.", "error");
      return;
    }

    verifyOtpBtn.disabled = true;
    setOtpMessage("Verifying OTP...", "info");
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, mobile, otp, otp_id: otpId }),
      });
      const data = await res.json();
      if (!data.ok) {
        setOtpMessage(data.error || "OTP verification failed.", "error");
        verifyOtpBtn.disabled = false;
        otpVerified = false;
        return;
      }

      otpVerified = true;
      if (otpValueEl) otpValueEl.textContent = "Verified";
      setOtpMessage("Verified successfully.", "success");
      if (otpTimerEl) otpTimerEl.textContent = "";
      if (otpTimer) clearInterval(otpTimer);
      sendOtpBtn.disabled = false;
      setOtpUiVisible(false);
    } catch (e) {
      setOtpMessage("OTP verification failed.", "error");
      verifyOtpBtn.disabled = false;
    }
  });
}

function startOtpCooldown() {
  otpSeconds = 30;
  sendOtpBtn.disabled = true;
  if (otpTimerEl) otpTimerEl.textContent = "(Resend in 30s)";
  otpTimer = setInterval(() => {
    otpSeconds -= 1;
    if (otpTimerEl) otpTimerEl.textContent = `(Resend in ${otpSeconds}s)`;
    if (otpSeconds <= 0) {
      clearInterval(otpTimer);
      sendOtpBtn.disabled = false;
      if (otpTimerEl) otpTimerEl.textContent = "";
    }
  }, 1000);
}

if (sigCanvas) {
  sigCanvas.addEventListener("mousedown", (e) => {
    drawing = true;
    lastPos = getPos(e.clientX, e.clientY);
  });

  sigCanvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    drawLine(e.clientX, e.clientY);
  });

  sigCanvas.addEventListener("mouseup", () => (drawing = false));

  sigCanvas.addEventListener("touchstart", (e) => {
    drawing = true;
    const t = e.touches[0];
    lastPos = getPos(t.clientX, t.clientY);
  });

  sigCanvas.addEventListener("touchmove", (e) => {
    if (!drawing) return;
    const t = e.touches[0];
    drawLine(t.clientX, t.clientY);
  });

  sigCanvas.addEventListener("touchend", () => (drawing = false));
}

function drawLine(x, y) {
  const ctx = sigCanvas.getContext("2d");
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  const pos = getPos(x, y);
  ctx.beginPath();
  ctx.moveTo(lastPos.x, lastPos.y);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  lastPos = pos;
}

if (sigClear) {
  sigClear.addEventListener("click", () => {
    const ctx = sigCanvas.getContext("2d");
    ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    sigData.value = "";
    if (sigSave) {
      sigSave.classList.remove("saved");
      sigSave.textContent = defaultSigSaveText;
    }
  });
}

if (sigSave) {
  sigSave.addEventListener("click", () => {
    sigData.value = sigCanvas.toDataURL("image/png");
    sigSave.classList.add("saved");
    sigSave.textContent = "signature saved";
  });
}

function getPos(clientX, clientY) {
  const rect = sigCanvas.getBoundingClientRect();
  return { x: (clientX - rect.left) * (sigCanvas.width / rect.width), y: (clientY - rect.top) * (sigCanvas.height / rect.height) };
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const fullName = String(formData.get("full_name") || "").trim();
    const mobile = String(formData.get("mobile") || "").trim();
    const aadhaar = String(formData.get("aadhaar") || "").trim();

    if (!isValidFullName(fullName)) {
      statusEl.textContent = "Full name must be at least 5 characters.";
      return;
    }
    if (!isValidMobile(mobile)) {
      statusEl.textContent = "Mobile number must be exactly 10 digits.";
      return;
    }
    if (!isValidAadhaar(aadhaar)) {
      statusEl.textContent = "Aadhaar number must be exactly 12 digits.";
      return;
    }

    if (!otpVerified) {
      statusEl.textContent = "Please verify OTP before submitting FIR.";
      return;
    }

    if (!sigData.value) {
      statusEl.textContent = "Please save your digital signature.";
      return;
    }

    if (ocrHidden && document.getElementById("ocrResult")) {
      ocrHidden.value = document.getElementById("ocrResult").value;
    }

    const payload = Object.fromEntries(formData.entries());
    const res = await fetch("/api/fir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      statusEl.textContent = `FIR submitted successfully. FIR ID: ${data.fir_id}`;
      if (firActions) firActions.style.display = "flex";
      lastFirUrls = { print_url: data.print_url, pdf_url: data.pdf_url };
      localStorage.setItem("last_fir_id", data.fir_id);
      if (data.print_url) localStorage.setItem("last_fir_print_url", data.print_url);
      if (data.pdf_url) localStorage.setItem("last_fir_pdf_url", data.pdf_url);
      if (trackIdInput) trackIdInput.value = data.fir_id;
      if (trackResult) await loadFir(data.fir_id);
      form.reset();
      if (sigCanvas) {
        const ctx = sigCanvas.getContext("2d");
        ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
      }
      if (sigSave) {
        sigSave.classList.remove("saved");
        sigSave.textContent = defaultSigSaveText;
      }
      otpVerified = false;
      if (verifyOtpBtn) verifyOtpBtn.disabled = true;
      if (otpValueEl) otpValueEl.textContent = "----";
      setOtpMessage("", "info");
      if (otpIdInput) otpIdInput.value = "";
      setOtpUiVisible(true);
    } else {
      statusEl.textContent = data.error || "Submission failed";
    }
  });
}

async function loadFir(id) {
  const res = await fetch(`/api/fir/${id}`);
  const data = await res.json();
  if (!data.ok) {
    if (trackResult) trackResult.innerHTML = `<div class="muted">${data.error || "FIR not found"}</div>`;
    return;
  }
  lastFirData = data.fir;
  lastFirUrls = {
    print_url: localStorage.getItem("last_fir_print_url"),
    pdf_url: localStorage.getItem("last_fir_pdf_url"),
  };
  if (trackResult) renderFir(data.fir);
}

function renderFir(f) {
  trackResult.innerHTML = `
    <div class="pill"><i class="fa-solid fa-file-circle-check"></i> FIR Active</div>
    <div class="track-row"><strong>ID</strong><span>${f.id}</span></div>
    <div class="track-row"><strong>Name</strong><span>${f.full_name}</span></div>
    <div class="track-row"><strong>Email</strong><span>${f.email || "-"}</span></div>
    <div class="track-row"><strong>Type</strong><span>${f.incident_type}</span></div>
    <div class="track-row"><strong>Location</strong><span>${f.incident_location}</span></div>
    <div class="track-row"><strong>Time</strong><span>${f.incident_time}</span></div>
    <div class="track-row"><strong>Status</strong><span>${f.status || "Submitted"}</span></div>
    <div class="track-row"><strong>Geo</strong><span>${f.geo_city || "-"}, ${f.geo_region || "-"}</span></div>
    <div class="track-row"><strong>Complaint</strong><span>${f.complaint || "-"}</span></div>
    <div class="track-row"><strong>OCR Text</strong><span>${f.ocr_text || "-"}</span></div>
    ${f.signature ? `<div class="track-row"><strong>Signature</strong><span><img src="${f.signature}" alt="Signature" style="max-width:220px;border:1px solid #e2e8f0;border-radius:8px;"/></span></div>` : ""}
  `;
  updateTimeline(f.status || "Submitted");
}

if (trackForm && trackIdInput) {
  trackForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = trackIdInput.value.trim();
    if (!id) return;
    await loadFir(id);
  });
}

function updateTimeline(status) {
  const steps = document.querySelectorAll("#statusTimeline .timeline-step");
  if (!steps.length) return;
  const order = ["Submitted", "In Review", "Assigned", "Closed"];
  const activeIndex = Math.max(0, order.indexOf(status));
  steps.forEach((step, idx) => {
    if (idx <= activeIndex) {
      step.classList.add("active");
    } else {
      step.classList.remove("active");
    }
  });
}

function buildPrintHtml(f) {
  return `
  <html><head><title>FIR Copy</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;}
      h1{margin-bottom:6px;}
      .meta{color:#475569;margin-bottom:18px;}
      table{width:100%;border-collapse:collapse;}
      td{padding:8px 6px;border-bottom:1px solid #e2e8f0;}
      .badge{display:inline-block;background:#f97316;color:white;padding:4px 8px;border-radius:6px;font-size:12px;}
    </style>
  </head><body>
    <h1>FIR Copy</h1>
    <div class="meta">Generated on ${new Date().toLocaleString()}</div>
    <table>
      <tr><td><strong>FIR ID</strong></td><td>${f.id}</td></tr>
      <tr><td><strong>Name</strong></td><td>${f.full_name}</td></tr>
      <tr><td><strong>Mobile</strong></td><td>${f.mobile}</td></tr>
      <tr><td><strong>Email</strong></td><td>${f.email || "-"}</td></tr>
      <tr><td><strong>Aadhaar</strong></td><td>${f.aadhaar}</td></tr>
      <tr><td><strong>Incident Type</strong></td><td>${f.incident_type}</td></tr>
      <tr><td><strong>Incident Location</strong></td><td>${f.incident_location}</td></tr>
      <tr><td><strong>Incident Time</strong></td><td>${f.incident_time}</td></tr>
      <tr><td><strong>Complaint</strong></td><td>${f.complaint}</td></tr>
      <tr><td><strong>OCR Text</strong></td><td>${f.ocr_text || "-"}</td></tr>
      <tr><td><strong>Geo</strong></td><td>${f.geo_city || "-"}, ${f.geo_region || "-"}, ${f.geo_country || "-"}</td></tr>
      <tr><td><strong>IP</strong></td><td>${f.geo_ip || "-"}</td></tr>
    </table>
    ${f.signature ? `<div class="sig"><div><strong>Signature</strong></div><img src="${f.signature}" alt="Signature" style="max-width:220px;border:1px solid #e2e8f0;border-radius:8px;"/></div>` : ""}
  </body></html>`;
}

if (downloadPdf) {
  downloadPdf.addEventListener("click", () => {
    if (lastFirUrls && lastFirUrls.pdf_url) {
      window.open(lastFirUrls.pdf_url, "_blank");
      return;
    }
    if (!lastFirData) return;
    const w = window.open("", "_blank");
    w.document.write(buildPrintHtml(lastFirData));
    w.document.close();
  });
}

if (printFir) {
  printFir.addEventListener("click", () => {
    if (lastFirUrls && lastFirUrls.print_url) {
      window.open(lastFirUrls.print_url, "_blank");
      return;
    }
    if (!lastFirData) return;
    const w = window.open("", "_blank");
    w.document.write(buildPrintHtml(lastFirData));
    w.document.close();
    w.print();
  });
}

function initIndiaMap() {
  const mapEl = document.getElementById("indiaMap");
  if (!mapEl || !window.L) return;
  const map = L.map(mapEl).setView([22.5, 78.9], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  const indiaCircle = L.circle([22.5, 78.9], { radius: 800000, color: "#f97316" })
    .addTo(map)
    .bindPopup("India Coverage");

  const mapIndiaBtn = document.getElementById("mapIndia");
  const mapUserBtn = document.getElementById("mapUser");
  const mapInfo = document.getElementById("mapInfo");
  let userMarker;

  function showIndia() {
    map.setView([22.5, 78.9], 5);
    indiaCircle.openPopup();
  }

  async function showUser() {
    try {
      const res = await fetch("https://ipapi.co/json/");
      const data = await res.json();
      const lat = data.latitude;
      const lng = data.longitude;
      if (mapInfo) {
        mapInfo.textContent = `Nearest location: ${data.city || "-"}, ${data.region || "-"} (${data.country_name || ""})`;
      }
      if (lat && lng) {
        map.setView([lat, lng], 10);
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker([lat, lng]).addTo(map).bindPopup("Nearest Location").openPopup();
      }
    } catch (e) {
      if (mapInfo) mapInfo.textContent = "Unable to detect location.";
    }
  }

  if (mapIndiaBtn) mapIndiaBtn.addEventListener("click", showIndia);
  if (mapUserBtn) mapUserBtn.addEventListener("click", showUser);

  // default: try to show user location once
  showUser();
}

initIndiaMap();
