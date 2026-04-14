
with open('Resource/teacherDashboard.html', 'r', encoding='ascii', errors='ignore') as f:
    content = f.read()

# Only keep content between <script> and </script>
start = content.find('<script>')
end = content.rfind('</script>')
script = content[start+8:end]

stack = []
for i, char in enumerate(script):
    if char == '{':
        stack.append(i)
    elif char == '}':
        if not stack:
            print(f"Extra closing brace at script char {i}")
        else:
            stack.pop()

if stack:
    print(f"Unclosed braces starting at indices: {stack}")
    # Show the code around the first unclosed brace
    for start_idx in stack:
        line_num = script[:start_idx].count('\n') + 1
        snippet = script[start_idx:start_idx+100]
        print(f"Unclosed brace at script line {line_num}: {snippet.strip()}...")
