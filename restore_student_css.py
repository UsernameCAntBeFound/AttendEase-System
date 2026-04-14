import re

# Read original
with open("/Users/macol/Downloads/AttendEase/Resource/studentDashboard.css", "r") as f:
    css = f.read()

# Apply theme
css = re.sub(r'--bg:\s*[^;]+;', '--bg: #f3efe9;', css)
css = re.sub(r'--brand:\s*[^;]+;', '--brand: #2d2f33;', css)
css = re.sub(r'--brand-dark:\s*[^;]+;', '--brand-dark: #1a1b1f;', css)
css = re.sub(r'--brand-gradient:\s*[^;]+;', '--brand-gradient: linear-gradient(135deg, #2d2f33 0%, #1a1b1f 100%);', css)
css = re.sub(r'--surface:\s*[^;]+;', '--surface: #ffffff;', css)
css = re.sub(r'--surface-solid:\s*[^;]+;', '--surface-solid: #ffffff;', css)
css = re.sub(r'--radius:\s*[^;]+;', '--radius: 20px;', css)

# Remove max-width on .page
css = re.sub(r'(\.page\s*\{[^}]*)max-width:\s*\d+px;([^}]*\})', r'\1\2', css)

# Fix hidden visibility
css = css.replace("/* ─────────────────────────── RESET & BASE ── */", "/* Ensure the HTML hidden attribute always wins over CSS display rules */\n[hidden] {\n    display: none !important;\n}\n\n/* ─────────────────────────── RESET & BASE ── */")

# Write to current
with open("Resource/studentDashboard.css", "w") as f:
    f.write(css)
