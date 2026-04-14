import re

with open("Resource/teacherDashboard.css", "r") as f:
    css = f.read()

# We need the entire sidebar region from line 43 up to 238
# Also we need to replace bottom-nav in studentDashboard.css

with open("Resource/studentDashboard.css", "r") as f:
    std_css = f.read()

# Instead of complex parsing, let's just append the exact CSS we need for sidebar
sidebar_css = """
/* ─────────────────────────── SIDEBAR ── */
.sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 240px;
    background: #fff;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    z-index: 900;
    transition: transform 0.3s ease, width 0.3s ease;
}
.sidebar-top {
    height: var(--top-h);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.brand {
    font-size: 19px;
    font-weight: 800;
    color: var(--brand-dark);
    letter-spacing: -0.04em;
}
.sidebar-close {
    display: none;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
}
.sidebar-nav {
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
}
.nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: none;
    border-radius: 10px;
    background: none;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    text-align: left;
    transition: all 0.18s ease;
}
.nav-item:hover {
    background: rgba(99, 102, 241, 0.06);
    color: var(--text);
}
.nav-item.active {
    background: rgba(75, 120, 229, 0.1);
    color: var(--brand);
    font-weight: 600;
}
.btn-sign-out-side {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    background: none;
    border: none;
    border-top: 1px solid var(--border);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.2s;
    width: 100%;
}
.btn-sign-out-side:hover {
    color: var(--brand);
}

.main-wrap {
    margin-left: 240px;
    display: flex;
    flex-direction: column;
    height: 100vh;
    transition: margin-left 0.3s ease;
    min-width: 0;
}

.hamburger {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
}
.hamburger span {
    display: block;
    width: 20px;
    height: 2px;
    background: var(--text-muted);
    border-radius: 2px;
    transition: all 0.2s;
}

body.sidebar-collapsed .sidebar { width: 80px; }
body.sidebar-collapsed .brand { display: none; }
body.sidebar-collapsed .nav-item { justify-content: center; padding: 12px; font-size: 0; }
body.sidebar-collapsed .nav-item svg { margin: 0; }
body.sidebar-collapsed .btn-sign-out-side { justify-content: center; font-size: 0; padding: 12px; margin: 0 auto; width: calc(100% - 24px); border-top: none; }
body.sidebar-collapsed .btn-sign-out-side svg { margin: 0; }
body.sidebar-collapsed .main-wrap { margin-left: 80px; }
body.sidebar-collapsed .hamburger span { width: 20px; }

@media (max-width: 900px) {
    .sidebar { transform: translateX(-100%); }
    .sidebar.open { transform: translateX(0); box-shadow: 8px 0 40px rgba(0, 0, 0, 0.12); }
    .sidebar-close { display: flex; }
    .main-wrap { margin-left: 0; }
    body.sidebar-collapsed .sidebar { transform: translateX(-100%); width: 240px; }
    body.sidebar-collapsed .main-wrap { margin-left: 0; }
}
"""

std_css = re.sub(r'/\* ─────────────────────────── BOTTOM NAV ── \*/.*?(?=</style>|\Z|<script|/\*|</body>)', sidebar_css, std_css, flags=re.DOTALL)

with open("Resource/studentDashboard.css", "w") as f:
    f.write(std_css)

