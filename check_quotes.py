
import os

path = 'Resource/teacherDashboard.html'
with open(path, 'r', encoding='ascii', errors='ignore') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    # Only check lines inside script tags
    # (Simple heuristic: between line 680 and 2562)
    if 680 <= i+1 <= 2562:
        # Check single quotes
        if line.count("'") % 2 != 0:
            # Ignore comments if they have single quotes like "don't"
            if "//" not in line and "/*" not in line:
                print(f"Odd single quotes at line {i+1}: {line.strip()}")
        # Check backticks
        if line.count("`") % 2 != 0:
             print(f"Odd backticks at line {i+1}: {line.strip()}")
