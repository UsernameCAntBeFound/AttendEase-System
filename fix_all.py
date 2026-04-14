import os
import re

# 1. FIX MAIN WRAP COLLAPSE SPACING
for file in ["Resource/teacherDashboard.css", "Resource/adminPanel.css", "Resource/studentDashboard.css"]:
    with open(file, "r") as f:
        content = f.read()
    # If the layout has a hardcoded margin-left, we change it to var(--sidebar-w)
    content = re.sub(r'\.main-wrap\s*\{[^}]*margin-left:\s*\d+px;[^}]*\}', 
                     lambda m: m.group(0).replace(re.search(r'margin-left:\s*\d+px;', m.group(0)).group(0), 'margin-left: var(--sidebar-w);'), content)
    with open(file, "w") as f:
        f.write(content)

# 2. REVERT STUDENT DASHBOARD
html_file = "Resource/studentDashboard.html"
with open(html_file, "r") as f:
    html = f.read()

# Remove sidebar layout and restore bottom-nav
if '<aside class="sidebar"' in html:
    # Replace sidebar with bottom_nav
    sidebar_match = re.search(r'<aside class="sidebar".*?</aside>', html, re.DOTALL)
    if sidebar_match:
        html = html.replace(sidebar_match.group(0), "")
    
    # Restore bottom nav at the end of body
    bottom_nav = """
    <!-- ========== BOTTOM NAV ========== -->
    <nav class="bottom-nav">
        <button class="nav-btn active" id="nav-scan" onclick="navigate('scan')">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="3" height="3" rx="0.5" />
                <rect x="19" y="14" width="2" height="2" rx="0.5" />
                <rect x="14" y="19" width="2" height="2" rx="0.5" />
                <rect x="18" y="18" width="3" height="3" rx="0.5" />
            </svg>
            <span>Scan</span>
        </button>
        <button class="nav-btn" id="nav-news" onclick="navigate('news')">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path
                    d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                <path d="M18 14h-8" />
                <path d="M15 18h-5" />
                <path d="M10 6h8v4h-8V6Z" />
            </svg>
            <span>News</span>
        </button>
        <button class="nav-btn" id="nav-profile" onclick="navigate('profile')">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
            </svg>
            <span>Profile</span>
        </button>
    </nav>
"""
    # Insert before <script>
    html = re.sub(r'<script>', bottom_nav + '\n    <script>', html)

    # Remove mainWrap <div class="main-wrap" id="mainWrap"> and </div> at the end of main
    html = html.replace('<div class="main-wrap" id="mainWrap">', '')
    html = re.sub(r'</main>\s*</div>', '</main>', html)
    
    # Restore topbar brand wrapper
    topbar_bad = """<div class="topbar-left">
            <button class="hamburger" onclick="toggleSidebar()">
                <span></span><span></span><span></span>
            </button>
            <span class="brand" style="display:none;">AttendEase</span>
        </div>"""
    topbar_good = '<span class="brand">AttendEase</span>'
    html = html.replace(topbar_bad, topbar_good)
    
    with open(html_file, "w") as f:
        f.write(html)

css_file = "Resource/studentDashboard.css"
with open(css_file, "r") as f:
    css = f.read()
if "/* ─────────────────────────── SIDEBAR ── */" in css:
    css = re.sub(r'/\* ─────────────────────────── SIDEBAR ── \*/.*', '', css, flags=re.DOTALL)
    bottom_nav_css = """
/* ─────────────────────────── BOTTOM NAV ── */
.bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--nav-h);
    display: flex;
    align-items: center;
    justify-content: space-around;
    background: rgba(255, 255, 255, 0.82);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    border-top: 1px solid var(--border);
    z-index: 100;
    padding-bottom: env(safe-area-inset-bottom, 0px);
}

.nav-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 100%;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.2s, transform 0.2s;
    font-family: inherit;
    position: relative;
}

.nav-btn span {
    font-size: 11px;
    font-weight: 500;
    margin-top: 2px;
}

.nav-btn.active {
    color: var(--brand);
}

.nav-btn.active::after {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 24px;
    height: 3px;
    background: var(--brand);
    border-radius: 0 0 3px 3px;
}
"""
    css += bottom_nav_css
    with open(css_file, "w") as f:
        f.write(css)

# 3. REPLACE EMOJIS
replacements = {
    '✅': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    '📘': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    '📢': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
    '🔍': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    '&#128205;': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    '📩': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    '🕒': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
}

import glob
for html_f in glob.glob("Resource/*.html"):
    with open(html_f, "r") as f:
        file_html = f.read()
    for emoji, svg in replacements.items():
        file_html = file_html.replace(emoji, svg)
    with open(html_f, "w") as f:
        f.write(file_html)

# 4. UPDATE INDEX.HTML THEME
index_file = "Resource/index.css"
if os.path.exists(index_file):
    with open(index_file, "r") as f:
        idx_css = f.read()
    idx_css = re.sub(r'--bg:\s*[^;]+;', '--bg: #f3efe9;', idx_css)
    idx_css = re.sub(r'--brand:\s*[^;]+;', '--brand: #2d2f33;', idx_css)
    idx_css = re.sub(r'--brand-dark:\s*[^;]+;', '--brand-dark: #1a1b1f;', idx_css)
    idx_css = re.sub(r'--brand-gradient:\s*[^;]+;', '--brand-gradient: linear-gradient(135deg, #2d2f33 0%, #1a1b1f 100%);', idx_css)
    idx_css = re.sub(r'--surface:\s*[^;]+;', '--surface: #ffffff;', idx_css)
    with open(index_file, "w") as f:
        f.write(idx_css)

