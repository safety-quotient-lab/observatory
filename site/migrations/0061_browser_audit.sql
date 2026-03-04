-- Browser audit: machine-verified structural signals from CF Browser Rendering.
-- Each row represents one headless browser visit to a domain's representative page.
-- Results feed br_* DCP elements that ground the structural channel in observation.

CREATE TABLE IF NOT EXISTS domain_browser_audit (
  domain TEXT PRIMARY KEY,
  audited_at TEXT NOT NULL,

  -- Tracking signals
  tracker_count INTEGER DEFAULT 0,
  tracker_domains TEXT,          -- JSON array of 3rd-party tracking domains detected
  fingerprint_apis TEXT,         -- JSON array: canvas, webgl, navigator, etc.

  -- Security signals
  has_https INTEGER DEFAULT 0,
  has_hsts INTEGER DEFAULT 0,
  has_csp INTEGER DEFAULT 0,
  csp_value TEXT,

  -- Accessibility signals
  has_lang_attr INTEGER DEFAULT 0,
  has_skip_nav INTEGER DEFAULT 0,
  images_without_alt INTEGER DEFAULT 0,
  total_images INTEGER DEFAULT 0,

  -- Consent signals
  has_cookie_banner INTEGER DEFAULT 0,
  cookie_banner_dismissable INTEGER DEFAULT 0,
  dark_pattern_flags TEXT,       -- JSON array of detected dark patterns

  -- Diagnostics
  request_log_json TEXT,         -- JSON: all network requests during page load
  audit_duration_ms INTEGER,
  audit_error TEXT               -- NULL on success
);
