
import os

path = 'Resource/teacherDashboard.html'
with open(path, 'r', encoding='ascii', errors='ignore') as f:
    content = f.read()

print(f'Braces: {content.count("{")} opens, {content.count("}")} closes')
print(f'Parens: {content.count("(")} opens, {content.count(")")} closes')
print(f'Backticks: {content.count("`")} total')
print(f'Square Brackets: {content.count("[")} opens, {content.count("]")} closes')

# Check for ${ missing backticks
import re
# Find ${ and check if it's inside backticks. This is hard with regex, 
# but we can look for ${ that ARE NOT preceded/followed by a backtick on the same line if it's simple.
lines = content.splitlines()
for i, line in enumerate(lines):
    if "${" in line and "`" not in line:
        print(f"Potential missing backtick at line {i+1}: {line.strip()}")
