-- Database schema for Virtual Police Station (MS336)
-- Files using these tables: server.js
-- If DB fails, fallback logs used: data/activity_logs.jsonl, data/visits_detail.jsonl

-- NOTE: Set this database name to match your .env (DB_NAME)
CREATE DATABASE IF NOT EXISTS `virtual_police`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `virtual_police`;

-- WARNING: This will DROP existing tables and data.
-- If you want to keep data, do NOT run the DROP statements.
DROP TABLE IF EXISTS visits_detail;
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS visits;
DROP TABLE IF EXISTS contact_messages;
DROP TABLE IF EXISTS firs;

-- Table: firs (used in server.js)
-- NOTE: Extra columns `ocr_file`, `signature_file`, and `incident_datetime` are optional
-- for compatibility with older schemas. The app currently uses `incident_time` and
-- stores signature data in `signature` (LONGTEXT).
CREATE TABLE IF NOT EXISTS firs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100),
  mobile VARCHAR(20),
  email VARCHAR(120),
  aadhaar VARCHAR(20),
  incident_time DATETIME,
  incident_datetime DATETIME,
  incident_type VARCHAR(50),
  incident_location VARCHAR(200),
  complaint TEXT,
  ocr_file VARCHAR(150),
  ocr_text TEXT,
  signature LONGTEXT,
  signature_file VARCHAR(150),
  geo_city VARCHAR(80),
  geo_region VARCHAR(80),
  geo_country VARCHAR(80),
  geo_ip VARCHAR(50),
  geo_lat DOUBLE,
  geo_lng DOUBLE,
  status VARCHAR(30) DEFAULT 'Submitted',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_firs_created_at (created_at),
  INDEX idx_firs_status (status),
  INDEX idx_firs_city (geo_city),
  INDEX idx_firs_type (incident_type)
);

-- Table: contact_messages (used in server.js)
CREATE TABLE IF NOT EXISTS contact_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100),
  email VARCHAR(120),
  mobile VARCHAR(20),
  category VARCHAR(50),
  message TEXT,
  attachment_path VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_contact_created_at (created_at)
);

-- Table: visits (used in server.js)
CREATE TABLE IF NOT EXISTS visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  visit_date DATE,
  page VARCHAR(120),
  count INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_visit (visit_date, page),
  INDEX idx_visits_date (visit_date)
);

-- Table: activity_logs (used in server.js)
CREATE TABLE IF NOT EXISTS activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(50),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activity_created_at (created_at)
);

-- Table: visits_detail (used in server.js)
CREATE TABLE IF NOT EXISTS visits_detail (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(64),
  city VARCHAR(80),
  region VARCHAR(80),
  country VARCHAR(80),
  page VARCHAR(120),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_visits_detail_created_at (created_at),
  INDEX idx_visits_detail_ip (ip)
);
