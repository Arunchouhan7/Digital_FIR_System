# Virtual Police Station (MS336)

## Features
- Aadhaar-based OTP verification
- OCR evidence upload
- Digital signature capture
- Geo-IP tagging with map
- FIR tracking and printable copy
- Admin dashboard with stats and geo map
- Visitor analytics + status timeline
- Contact form with attachments

## Tech Stack
- Frontend: HTML, CSS, JS
- Backend: Node.js + Express
- Database: MySQL

## Quick Start (Node Hosting)
1. Install Node.js (LTS).
2. Create a MySQL database.
3. Update `.env` before upload:
   - Set `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`
   - Admin defaults: `ADMIN_USER=admin`, `ADMIN_PASS=admin123` (change in production)
   - Set `FAST2SMS_API_KEY` for OTP SMS
   - For Email OTP, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
   - If using Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=your_full_email@gmail.com`, `SMTP_PASS=your_16_char_app_password`
4. Install dependencies:
   - `npm install`
5. Start server:
   - `npm run start`
6. Open `http://localhost:3000`

## Database Setup (MySQL)
Run these in phpMyAdmin or MySQL client:

```sql
CREATE TABLE firs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100),
  mobile VARCHAR(20),
  aadhaar VARCHAR(20),
  incident_time DATETIME,
  incident_type VARCHAR(50),
  incident_location VARCHAR(200),
  complaint TEXT,
  signature LONGTEXT,
  geo_city VARCHAR(80),
  geo_region VARCHAR(80),
  geo_country VARCHAR(80),
  geo_ip VARCHAR(50),
  geo_lat DOUBLE,
  geo_lng DOUBLE,
  status VARCHAR(30) DEFAULT 'Submitted',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contact_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100),
  email VARCHAR(120),
  mobile VARCHAR(20),
  category VARCHAR(50),
  message TEXT,
  attachment_path VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  visit_date DATE,
  page VARCHAR(120),
  count INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_visit (visit_date, page)
);

CREATE TABLE activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(50),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE visits_detail (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(64),
  city VARCHAR(80),
  region VARCHAR(80),
  country VARCHAR(80),
  page VARCHAR(120),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

If DB connection fails, admin logs and visitor details are also written to:
- `data/activity_logs.jsonl`
- `data/visits_detail.jsonl`

## Admin Login
- Default (current): `admin` / `admin123`
- Change in `.env` before production use.

## Notes
- Leaflet map uses OpenStreetMap tiles.
- OCR uses `tesseract.js` in the browser.
- Geo-IP uses `ipapi.co`.
- OTP SMS uses Fast2SMS (`FAST2SMS_API_KEY` in `.env`).
- Ensure `uploads/` folder is writable.
- Admin page is hidden from public navigation. Access via `/admin`.

## Folder Structure
- `server.js` (Express server)
- `public/` (frontend)
- `public/admin/index.html` (admin UI)
- `public/admin/index.html` (admin page)
- `public/assets/` (css, js, img)
- `uploads/` (contact attachments)
