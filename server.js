const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const fetch = global.fetch ? global.fetch : (...args) => import("node-fetch").then(({default: f}) => f(...args));
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch (e) {
  // nodemailer is optional until SMTP is configured
}
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function ensureFirEmailColumn() {
  try {
    await pool.execute("ALTER TABLE firs ADD COLUMN email VARCHAR(120) NULL AFTER mobile");
  } catch (e) {
    // Ignore if column already exists.
  }
}

const PDF_SECRET = process.env.PDF_SECRET || process.env.ADMIN_PASS || "change-me";
const TOKEN_MAX_AGE_MS = Number(process.env.PDF_TOKEN_MAX_AGE_MS || "") || 7 * 24 * 60 * 60 * 1000;
const FAST2SMS_API_KEY = (process.env.FAST2SMS_API_KEY || "").trim();
const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || "") || 5 * 60 * 1000;
const OTP_RESEND_MS = Number(process.env.OTP_RESEND_MS || "") || 30 * 1000;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || "") || 5;
const OTP_DEV_BYPASS = String(process.env.OTP_DEV_BYPASS || "").toLowerCase() === "true";
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || "") || 587;
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || "no-reply@virtual-police.local").trim();

const otpStoreById = new Map();
const otpCooldownByMobile = new Map();
let smtpTransporterPromise = null;

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

async function logActivity(action, details) {
  try {
    await pool.execute(
      "INSERT INTO activity_logs (action, details) VALUES (?, ?)",
      [action, details || ""]
    );
  } catch (e) {
    const line = JSON.stringify({ action, details: details || "", created_at: new Date().toISOString() }) + "\n";
    fs.appendFileSync(path.join(dataDir, "activity_logs.jsonl"), line);
  }
}

function logVisitDetail(payload) {
  try {
    const line = JSON.stringify({ ...payload, created_at: new Date().toISOString() }) + "\n";
    fs.appendFileSync(path.join(dataDir, "visits_detail.jsonl"), line);
  } catch (e) {
    // ignore
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  const ip = req.socket.remoteAddress || "";
  return ip.startsWith("::ffff:") ? ip.replace("::ffff:", "") : ip;
}

function makeToken(id) {
  const ts = Date.now();
  const sig = crypto.createHmac("sha256", PDF_SECRET).update(`${id}.${ts}`).digest("base64url");
  return `${id}.${ts}.${sig}`;
}

function verifyToken(id, token) {
  if (!token) return false;
  const parts = String(token).split(".");
  if (parts.length !== 3) return false;
  const [tokenId, tsStr, sig] = parts;
  if (String(tokenId) !== String(id)) return false;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  if (Date.now() - ts > TOKEN_MAX_AGE_MS) return false;
  const expected = crypto.createHmac("sha256", PDF_SECRET).update(`${tokenId}.${tsStr}`).digest("base64url");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function buildPublicUrl(req, path) {
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}${path}`;
}

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(.+);base64,(.*)$/);
  if (!match) return null;
  return Buffer.from(match[2], "base64");
}

function normalizeMobile(input) {
  if (!input) return "";
  const digits = String(input).replace(/\D/g, "");
  if (digits.length <= 10) return digits;
  return digits.slice(-10);
}

function normalizeAadhaar(input) {
  if (!input) return "";
  return String(input).replace(/\D/g, "");
}

function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function isValidEmail(input) {
  const value = String(input || "").trim();
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmail(input) {
  return String(input || "").trim().toLowerCase();
}

function isSmtpConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getMissingSmtpFields() {
  const missing = [];
  if (!SMTP_HOST) missing.push("SMTP_HOST");
  if (!SMTP_USER) missing.push("SMTP_USER");
  if (!SMTP_PASS) missing.push("SMTP_PASS");
  return missing;
}

function getInvalidSmtpConfigReason() {
  // Common Gmail mistake: using a label like "smtp" instead of full email id.
  if (SMTP_HOST.includes("gmail.com") && SMTP_USER && !SMTP_USER.includes("@")) {
    return "SMTP_USER must be your full Gmail address when using smtp.gmail.com";
  }
  return "";
}

function buildSmtpErrorMessage(error) {
  const raw = String(error?.message || "").trim();
  const code = String(error?.code || "").trim();
  if (code === "EAUTH") {
    return "SMTP authentication failed (EAUTH). Check SMTP_USER and SMTP_PASS (use app password for Gmail).";
  }
  if (code === "ESOCKET" || code === "ECONNECTION") {
    return "SMTP connection failed. Check SMTP_HOST, SMTP_PORT, SMTP_SECURE, firewall/network access.";
  }
  if (raw) return `SMTP error: ${raw}`;
  return "SMTP send failed. Check SMTP settings in .env.";
}

async function getSmtpTransporter() {
  if (!nodemailer) {
    throw new Error("Missing dependency: nodemailer");
  }
  if (!isSmtpConfigured()) {
    throw new Error("SMTP config missing");
  }
  if (!smtpTransporterPromise) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    smtpTransporterPromise = transporter.verify().then(() => transporter);
  }
  return smtpTransporterPromise;
}

async function sendOtpEmail(email, otpCode) {
  const transporter = await getSmtpTransporter();
  await transporter.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: "Your OTP Code",
    text: `Your OTP is ${otpCode}. It will expire in ${Math.floor(OTP_TTL_MS / 60000)} minutes.`,
    html: `<p>Your OTP is <strong>${otpCode}</strong>.</p><p>It will expire in ${Math.floor(OTP_TTL_MS / 60000)} minutes.</p>`,
  });
}

function buildFirHtml(f, req) {
  return `
  <html><head><title>FIR Copy</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;}
      h1{margin-bottom:6px;}
      .meta{color:#475569;margin-bottom:18px;}
      table{width:100%;border-collapse:collapse;}
      td{padding:8px 6px;border-bottom:1px solid #e2e8f0;}
      .badge{display:inline-block;background:#f97316;color:white;padding:4px 8px;border-radius:6px;font-size:12px;}
      .sig{margin-top:14px;}
      .sig img{max-width:260px;border:1px solid #e2e8f0;border-radius:8px;}
      .foot{margin-top:18px;color:#64748b;font-size:12px;}
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
      <tr><td><strong>Status</strong></td><td>${f.status || "Submitted"}</td></tr>
      <tr><td><strong>Complaint</strong></td><td>${f.complaint}</td></tr>
      <tr><td><strong>OCR Text</strong></td><td>${f.ocr_text || "-"}</td></tr>
      <tr><td><strong>Geo</strong></td><td>${f.geo_city || "-"}, ${f.geo_region || "-"}, ${f.geo_country || "-"}</td></tr>
      <tr><td><strong>IP</strong></td><td>${f.geo_ip || "-"}</td></tr>
    </table>
    ${f.signature ? `<div class="sig"><div><strong>Signature</strong></div><img src="${f.signature}" alt="Signature" /></div>` : ""}
  </body></html>`;
}

// Visit logger
app.use(async (req, res, next) => {
  try {
    if (req.method === "GET" && (req.path === "/" || req.path.endsWith(".html"))) {
      const page = req.path === "/" ? "/index.html" : req.path;
      try {
        await pool.execute(
          "INSERT INTO visits (visit_date, page, count) VALUES (CURDATE(), ?, 1) ON DUPLICATE KEY UPDATE count = count + 1",
          [page]
        );
      } catch (e) {
        // ignore
      }

      const ip = getClientIp(req);
      let city = null, region = null, country = null;
      try {
        if (ip && ip !== "127.0.0.1" && ip !== "::1") {
          const geoRes = await fetch(`https://ipapi.co/${ip}/json/`);
          const geo = await geoRes.json();
          city = geo.city || null;
          region = geo.region || null;
          country = geo.country_name || null;
        }
      } catch (e) {}

      try {
        await pool.execute(
          "INSERT INTO visits_detail (ip, city, region, country, page) VALUES (?,?,?,?,?)",
          [ip, city, region, country, page]
        );
      } catch (e) {
        logVisitDetail({ ip, city, region, country, page });
      }
    }
  } catch (e) {
    // ignore
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const name = `contact_${Date.now()}_${Math.floor(Math.random() * 9999)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.mimetype)) return cb(new Error("Invalid file type"));
    cb(null, true);
  },
});

app.post("/api/otp/send", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const mobileRaw = req.body?.mobile;
    const mobile = normalizeMobile(mobileRaw);
    const isEmailOtp = !!email;

    if (isEmailOtp && !isValidEmail(email)) {
      return res.json({ ok: false, error: "Invalid email address" });
    }
    if (!isEmailOtp && (!mobile || mobile.length !== 10)) {
      return res.json({ ok: false, error: "Enter valid email or mobile number" });
    }

    const recipientKey = isEmailOtp ? `email:${email}` : `mobile:${mobile}`;
    const lastSentAt = otpCooldownByMobile.get(recipientKey) || 0;
    const now = Date.now();
    const waitMs = OTP_RESEND_MS - (now - lastSentAt);
    if (waitMs > 0) {
      return res.json({ ok: false, error: `Please wait ${Math.ceil(waitMs / 1000)}s before resending` });
    }

    const otpCode = String(crypto.randomInt(100000, 1000000));
    const otpId = crypto.randomBytes(12).toString("hex");
    const record = {
      recipientKey,
      codeHash: hashOtp(otpCode),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      verified: false,
    };

    otpStoreById.set(otpId, record);
    otpCooldownByMobile.set(recipientKey, now);

    if (isEmailOtp) {
      if (OTP_DEV_BYPASS) {
        return res.json({
          ok: true,
          otp_id: otpId,
          expires_in: Math.floor(OTP_TTL_MS / 1000),
          mode: "email-dev-bypass",
        });
      }
      const missingSmtp = getMissingSmtpFields();
      if (missingSmtp.length) {
        otpStoreById.delete(otpId);
        return res.json({
          ok: false,
          error: `Email OTP not configured. Missing: ${missingSmtp.join(", ")}`,
        });
      }
      const invalidSmtpReason = getInvalidSmtpConfigReason();
      if (invalidSmtpReason) {
        otpStoreById.delete(otpId);
        return res.json({
          ok: false,
          error: invalidSmtpReason,
        });
      }
      try {
        await sendOtpEmail(email, otpCode);
        return res.json({
          ok: true,
          otp_id: otpId,
          expires_in: Math.floor(OTP_TTL_MS / 1000),
          mode: "email",
        });
      } catch (e) {
        console.error("Email OTP send error:", e?.message || e);
        otpStoreById.delete(otpId);
        return res.json({
          ok: false,
          error: buildSmtpErrorMessage(e),
        });
      }
    }

    if (!FAST2SMS_API_KEY) {
      if (!OTP_DEV_BYPASS) {
        otpStoreById.delete(otpId);
        return res.json({
          ok: false,
          error: "FAST2SMS_API_KEY missing. Add it in .env, or set OTP_DEV_BYPASS=true for local testing.",
        });
      }
      return res.json({
        ok: true,
        otp_id: otpId,
        expires_in: Math.floor(OTP_TTL_MS / 1000),
        dev_otp: otpCode,
        mode: "dev-bypass",
      });
    }

    const smsRes = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        authorization: FAST2SMS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        route: "otp",
        variables_values: otpCode,
        numbers: mobile,
        flash: 0,
      }),
    });

    const smsText = await smsRes.text();
    let smsData = {};
    try {
      smsData = JSON.parse(smsText);
    } catch {}

    if (!smsRes.ok || smsData.return === false || smsData.status === "ERROR") {
      console.error("Fast2SMS error:", {
        status: smsRes.status,
        body: smsText,
      });
      if (OTP_DEV_BYPASS) {
        return res.json({
          ok: true,
          otp_id: otpId,
          expires_in: Math.floor(OTP_TTL_MS / 1000),
          dev_otp: otpCode,
          mode: "dev-bypass-fallback",
        });
      }
      otpStoreById.delete(otpId);
      const msg = String(smsData.message || "").toLowerCase();
      if (msg.includes("invalid authentication") || msg.includes("authorization key")) {
        return res.json({
          ok: false,
          error: "Invalid FAST2SMS_API_KEY in .env. Update the key or set OTP_DEV_BYPASS=true for local testing.",
        });
      }
      return res.json({ ok: false, error: smsData.message || "OTP send failed" });
    }

    return res.json({ ok: true, otp_id: otpId, expires_in: Math.floor(OTP_TTL_MS / 1000) });
  } catch (e) {
    return res.json({ ok: false, error: "OTP send failed" });
  }
});

app.post("/api/otp/verify", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const mobileRaw = req.body?.mobile;
    const otpRaw = req.body?.otp;
    const otpId = String(req.body?.otp_id || "");
    const mobile = normalizeMobile(mobileRaw);
    const otp = String(otpRaw || "").trim();
    const isEmailOtp = !!email;

    if (isEmailOtp && !isValidEmail(email)) {
      return res.json({ ok: false, error: "Invalid email address" });
    }
    if (!isEmailOtp && (!mobile || mobile.length !== 10)) {
      return res.json({ ok: false, error: "Enter valid email or mobile number" });
    }
    if (!otpId) {
      return res.json({ ok: false, error: "OTP session missing" });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.json({ ok: false, error: "Invalid OTP format" });
    }

    const otpRecord = otpStoreById.get(otpId);
    if (!otpRecord) {
      return res.json({ ok: false, error: "OTP expired or not found" });
    }
    if (otpRecord.expiresAt < Date.now()) {
      otpStoreById.delete(otpId);
      return res.json({ ok: false, error: "OTP expired" });
    }
    const recipientKey = isEmailOtp ? `email:${email}` : `mobile:${mobile}`;
    if (otpRecord.recipientKey !== recipientKey) {
      return res.json({ ok: false, error: "OTP not valid for this recipient" });
    }
    if (otpRecord.verified) {
      return res.json({ ok: true, verified: true });
    }

    otpRecord.attempts += 1;
    if (otpRecord.attempts > OTP_MAX_ATTEMPTS) {
      otpStoreById.delete(otpId);
      return res.json({ ok: false, error: "Too many OTP attempts" });
    }
    if (hashOtp(otp) !== otpRecord.codeHash) {
      return res.json({ ok: false, error: "Invalid OTP" });
    }

    otpRecord.verified = true;
    return res.json({ ok: true, verified: true });
  } catch (e) {
    return res.json({ ok: false, error: "OTP verification failed" });
  }
});

app.post("/api/fir", async (req, res) => {
  try {
    const {
      full_name,
      mobile,
      email,
      otp_id,
      aadhaar,
      incident_time,
      incident_type,
      incident_location,
      complaint,
      signature,
      ocr_text,
      geo_json,
    } = req.body;

    const fullNameNorm = String(full_name || "").trim();
    const aadhaarNorm = normalizeAadhaar(aadhaar);

    if (!fullNameNorm || !mobile || !email || !aadhaarNorm || !incident_time || !incident_type || !incident_location || !complaint) {
      return res.json({ ok: false, error: "Missing fields" });
    }
    if (fullNameNorm.length < 5) {
      return res.json({ ok: false, error: "Full name must be at least 5 characters" });
    }

    const mobileNorm = normalizeMobile(mobile);
    if (!mobileNorm || mobileNorm.length !== 10) {
      return res.json({ ok: false, error: "Invalid mobile number" });
    }
    if (!/^\d{12}$/.test(aadhaarNorm)) {
      return res.json({ ok: false, error: "Invalid Aadhaar number" });
    }
    if (!isValidEmail(email)) {
      return res.json({ ok: false, error: "Invalid email address" });
    }

    const emailNorm = normalizeEmail(email);
    const otpId = String(otp_id || "");
    if (!otpId) {
      return res.json({ ok: false, error: "OTP session missing" });
    }
    const otpRecord = otpStoreById.get(otpId);
    if (!otpRecord) {
      return res.json({ ok: false, error: "OTP expired or not found" });
    }
    if (otpRecord.expiresAt < Date.now()) {
      otpStoreById.delete(otpId);
      return res.json({ ok: false, error: "OTP expired" });
    }
    if (otpRecord.recipientKey !== `email:${emailNorm}`) {
      return res.json({ ok: false, error: "OTP not valid for this email" });
    }
    if (!otpRecord.verified) {
      return res.json({ ok: false, error: "Please verify OTP first" });
    }
    otpStoreById.delete(otpId);

    let geo = {};
    try { geo = JSON.parse(geo_json || "{}"); } catch {}

    const status = "Submitted";
    const [result] = await pool.execute(
      `INSERT INTO firs
      (full_name, mobile, email, aadhaar, incident_time, incident_type, incident_location, complaint, signature, ocr_text,
       geo_city, geo_region, geo_country, geo_ip, geo_lat, geo_lng, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        fullNameNorm,
        mobileNorm,
        emailNorm,
        aadhaarNorm,
        incident_time,
        incident_type,
        incident_location,
        complaint,
        signature,
        ocr_text || null,
        geo.city || null,
        geo.region || null,
        geo.country_name || null,
        geo.ip || null,
        geo.latitude || null,
        geo.longitude || null,
        status,
      ]
    );

    await logActivity("FIR_SUBMITTED", `FIR ID ${result.insertId} submitted by ${fullNameNorm}`);
    const token = makeToken(result.insertId);
    return res.json({
      ok: true,
      fir_id: result.insertId,
      print_url: buildPublicUrl(req, `/fir/print/${result.insertId}?token=${token}`),
      pdf_url: buildPublicUrl(req, `/fir/pdf/${result.insertId}?token=${token}`),
    });
  } catch (e) {
    console.error("FIR insert error:", e);
    return res.json({ ok: false, error: `DB insert failed: ${e.code || e.message || "unknown"}` });
  }
});

app.get("/api/fir/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await pool.execute(
      "SELECT id, full_name, mobile, email, aadhaar, incident_time, incident_type, incident_location, complaint, signature, ocr_text, geo_city, geo_region, geo_country, geo_ip, status, created_at FROM firs WHERE id=?",
      [id]
    );
    if (!rows.length) return res.json({ ok: false, error: "FIR not found" });
    return res.json({ ok: true, fir: rows[0] });
  } catch (e) {
    return res.json({ ok: false, error: "Failed" });
  }
});

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    await logActivity("ADMIN_LOGIN", `Admin login: ${username}`);
    return res.json({ ok: true });
  }
  return res.json({ ok: false, error: "Invalid credentials" });
});

app.get("/api/admin/firs", async (req, res) => {
  const { status, city, type, from, to, id, mobile } = req.query;
  const where = [];
  const params = [];
  if (id) { where.push("id=?"); params.push(id); }
  if (mobile) { where.push("mobile LIKE ?"); params.push(`%${mobile}%`); }
  if (status) { where.push("status=?"); params.push(status); }
  if (city) { where.push("geo_city LIKE ?"); params.push(`%${city}%`); }
  if (type) { where.push("incident_type LIKE ?"); params.push(`%${type}%`); }
  if (from) { where.push("DATE(created_at) >= ?"); params.push(from); }
  if (to) { where.push("DATE(created_at) <= ?"); params.push(to); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await pool.execute(
    `SELECT id as fir_id, full_name, email, incident_type, incident_location, incident_time, status, geo_lat, geo_lng, geo_city, geo_ip, created_at FROM firs ${clause} ORDER BY id DESC`,
    params
  );
  res.json(rows);
});

app.post("/api/admin/status", async (req, res) => {
  const { id, status } = req.body;
  const allowed = ["Submitted", "In Review", "Assigned", "Closed"];
  if (!id || !allowed.includes(status)) return res.json({ ok: false, error: "Invalid" });
  await pool.execute("UPDATE firs SET status=? WHERE id=?", [status, id]);
  await logActivity("STATUS_UPDATE", `FIR ${id} -> ${status}`);
  res.json({ ok: true });
});

app.get("/api/admin/stats", async (req, res) => {
  try {
    const [[totalRow]] = await pool.query("SELECT COUNT(*) c FROM firs");
    const [[todayRow]] = await pool.query("SELECT COUNT(*) c FROM firs WHERE DATE(created_at)=CURDATE()");
    const [[citiesRow]] = await pool.query("SELECT COUNT(DISTINCT geo_city) c FROM firs");
    const [[visitsToday]] = await pool.query("SELECT IFNULL(SUM(count),0) c FROM visits WHERE visit_date=CURDATE()");
    const [[visitsTotal]] = await pool.query("SELECT IFNULL(SUM(count),0) c FROM visits");
    const [[activeRow]] = await pool.query("SELECT COUNT(*) c FROM visits_detail WHERE created_at >= (NOW() - INTERVAL 5 MINUTE)");

    res.json({
      total: totalRow.c || 0,
      today: todayRow.c || 0,
      cities: citiesRow.c || 0,
      visits_today: visitsToday.c || 0,
      visits_total: visitsTotal.c || 0,
      active_users: activeRow.c || 0,
    });
  } catch (e) {
    res.json({ total: 0, today: 0, cities: 0, visits_today: 0, visits_total: 0, active_users: 0 });
  }
});

app.get("/api/admin/visits", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT visit_date, SUM(count) c FROM visits GROUP BY visit_date ORDER BY visit_date DESC LIMIT 7"
    );
    const ordered = rows.reverse();
    res.json({
      labels: ordered.map((r) => r.visit_date.toISOString().slice(0,10)),
      counts: ordered.map((r) => r.c),
    });
  } catch (e) {
    res.json({ labels: [], counts: [] });
  }
});

app.get("/api/admin/visitors", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT ip, city, region, country, page, created_at FROM visits_detail ORDER BY id DESC LIMIT 200"
    );
    res.json(rows);
  } catch (e) {
    const file = path.join(dataDir, "visits_detail.jsonl");
    if (!fs.existsSync(file)) return res.json([]);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    const rows = lines.map((l) => JSON.parse(l)).slice(-200).reverse();
    res.json(rows);
  }
});

app.get("/api/admin/visits/monthly", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT DATE_FORMAT(visit_date, '%Y-%m') m, SUM(count) c FROM visits GROUP BY m ORDER BY m DESC LIMIT 12"
    );
    const ordered = rows.reverse();
    res.json({
      labels: ordered.map((r) => r.m),
      counts: ordered.map((r) => r.c),
    });
  } catch (e) {
    res.json({ labels: [], counts: [] });
  }
});

app.get("/api/admin/visits/yearly", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT DATE_FORMAT(visit_date, '%Y') y, SUM(count) c FROM visits GROUP BY y ORDER BY y DESC LIMIT 5"
    );
    const ordered = rows.reverse();
    res.json({
      labels: ordered.map((r) => r.y),
      counts: ordered.map((r) => r.c),
    });
  } catch (e) {
    res.json({ labels: [], counts: [] });
  }
});

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  rows.forEach((r) => {
    lines.push(headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","));
  });
  return lines.join("\n");
}

app.get("/api/admin/export/firs", async (req, res) => {
  const { status, city, type, from, to, id, mobile } = req.query;
  const where = [];
  const params = [];
  if (id) { where.push("id=?"); params.push(id); }
  if (mobile) { where.push("mobile LIKE ?"); params.push(`%${mobile}%`); }
  if (status) { where.push("status=?"); params.push(status); }
  if (city) { where.push("geo_city LIKE ?"); params.push(`%${city}%`); }
  if (type) { where.push("incident_type LIKE ?"); params.push(`%${type}%`); }
  if (from) { where.push("DATE(created_at) >= ?"); params.push(from); }
  if (to) { where.push("DATE(created_at) <= ?"); params.push(to); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await pool.execute(
    `SELECT id, full_name, mobile, email, aadhaar, incident_time, incident_type, incident_location, complaint, ocr_text, status, geo_city, geo_ip, created_at FROM firs ${clause} ORDER BY id DESC`,
    params
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=firs.csv");
  res.send(toCsv(rows));
});

app.get("/api/admin/export/contacts", async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, full_name, email, mobile, category, message, attachment_path, created_at FROM contact_messages ORDER BY id DESC"
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=contacts.csv");
  res.send(toCsv(rows));
});

app.get("/api/admin/export/visitors", async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT ip, city, region, country, page, created_at FROM visits_detail ORDER BY id DESC"
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=visitors.csv");
  res.send(toCsv(rows));
});

app.get("/api/admin/contacts", async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, full_name, email, mobile, category, message, attachment_path, created_at FROM contact_messages ORDER BY id DESC"
  );
  res.json(rows);
});

app.get("/api/admin/fir-token/:id", async (req, res) => {
  const id = req.params.id;
  const token = makeToken(id);
  return res.json({
    ok: true,
    print_url: buildPublicUrl(req, `/fir/print/${id}?token=${token}`),
    pdf_url: buildPublicUrl(req, `/fir/pdf/${id}?token=${token}`),
  });
});

app.post("/api/contact", upload.single("attachment"), async (req, res) => {
  try {
    const { full_name, email, mobile, category, message } = req.body;
    if (!full_name || !email || !mobile || !category || !message) {
      return res.json({ ok: false, error: "Missing fields" });
    }
    const attachment_path = req.file ? `uploads/${req.file.filename}` : null;
    await pool.execute(
      "INSERT INTO contact_messages (full_name, email, mobile, category, message, attachment_path) VALUES (?,?,?,?,?,?)",
      [full_name, email, mobile, category, message, attachment_path]
    );
    await logActivity("CONTACT_SUBMITTED", `Contact request from ${full_name} (${email})`);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: "Submission failed" });
  }
});

app.get("/api/admin/logs", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, action, details, created_at FROM activity_logs ORDER BY id DESC LIMIT 200"
    );
    res.json(rows);
  } catch (e) {
    const file = path.join(dataDir, "activity_logs.jsonl");
    if (!fs.existsSync(file)) return res.json([]);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    const rows = lines.map((l) => JSON.parse(l)).slice(-200).reverse();
    res.json(rows);
  }
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "index.html"));
});

app.get("/fir/print/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!verifyToken(id, req.query.token)) return res.status(403).send("Invalid token");
    const [rows] = await pool.execute(
      "SELECT id, full_name, mobile, email, aadhaar, incident_time, incident_type, incident_location, complaint, signature, ocr_text, geo_city, geo_region, geo_country, geo_ip, status FROM firs WHERE id=?",
      [id]
    );
    if (!rows.length) return res.status(404).send("Not found");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildFirHtml(rows[0], req));
  } catch (e) {
    res.status(500).send("Failed");
  }
});

app.get("/fir/pdf/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!verifyToken(id, req.query.token)) return res.status(403).send("Invalid token");
    const [rows] = await pool.execute(
      "SELECT id, full_name, mobile, email, aadhaar, incident_time, incident_type, incident_location, complaint, signature, ocr_text, geo_city, geo_region, geo_country, geo_ip, status FROM firs WHERE id=?",
      [id]
    );
    if (!rows.length) return res.status(404).send("Not found");
    const f = rows[0];

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=fir_${id}.pdf`);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text("FIR Copy");
    doc.fontSize(10).fillColor("#555").text(`Generated on ${new Date().toLocaleString()}`);
    doc.fillColor("#111").moveDown();

    const rowsOut = [
      ["FIR ID", f.id],
      ["Name", f.full_name],
      ["Mobile", f.mobile],
      ["Email", f.email || "-"],
      ["Aadhaar", f.aadhaar],
      ["Incident Type", f.incident_type],
      ["Incident Location", f.incident_location],
      ["Incident Time", f.incident_time],
      ["Status", f.status || "Submitted"],
      ["Complaint", f.complaint],
      ["OCR Text", f.ocr_text || "-"],
      ["Geo", `${f.geo_city || "-"}, ${f.geo_region || "-"}, ${f.geo_country || "-"}`],
      ["IP", f.geo_ip || "-"],
    ];

    rowsOut.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
      doc.font("Helvetica").text(String(value ?? ""));
    });

    if (f.signature) {
      const sigBuf = dataUrlToBuffer(f.signature);
      if (sigBuf) {
        doc.moveDown(0.8);
        doc.font("Helvetica-Bold").text("Signature:");
        doc.image(sigBuf, { width: 200 });
      }
    }

    doc.end();
  } catch (e) {
    res.status(500).send("Failed");
  }
});

app.use((err, req, res, next) => {
  if (err) {
    return res.json({ ok: false, error: err.message || "Upload failed" });
  }
  next();
});

ensureFirEmailColumn()
  .catch(() => {})
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });
