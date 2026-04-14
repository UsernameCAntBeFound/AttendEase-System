
with open('Resource/teacherDashboard.html', 'r', encoding='ascii', errors='ignore') as f:
    content = f.read()
print("Backticks:", content.count("`"))
print("Single quotes:", content.count("'"))
print("Double quotes:", content.count('"'))
print("Left braces:", content.count("{"))
print("Right braces:", content.count("}"))
