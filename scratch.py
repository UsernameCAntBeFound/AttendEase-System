import re

with open("Resource/teacherDashboard.css", "r") as f:
    css = f.read()

# We need :root { --sidebar-w: 240px; } added to studentDashboard.css
# Let's extract the sidebar rules.
sidebar_blocks = re.findall(r'(\.sidebar[^{]*\{[^}]*\})', css)
sidebar_nav = re.findall(r'(\.sidebar-nav[^{]*\{[^}]*\})', css)
nav_item = re.findall(r'(\.nav-item[^{]*\{[^}]*\})', css)
main_wrap = re.findall(r'(\.main-wrap[^{]*\{[^}]*\})', css)
topbar = re.findall(r'(\.topbar[^{]*\{[^}]*\})', css)
topbar_left = re.findall(r'(\.topbar-left[^{]*\{[^}]*\})', css)
hamburger = re.findall(r'(\.hamburger[^{]*\{[^}]*\})', css)

with open("scratch.css", "w") as f:
    f.write("\n\n/* IMPORTED SIDEBAR CLASSES */\n")
    for block in sidebar_blocks + sidebar_nav + nav_item + main_wrap + topbar + topbar_left + hamburger:
        f.write(block + "\n")

