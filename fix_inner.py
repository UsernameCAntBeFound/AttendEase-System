import glob, re
for f_name in glob.glob("Resource/*.html"):
    with open(f_name, "r") as f: content = f.read()
    # Find `.textContent = ... <svg ...` and replace `.textContent` with `.innerHTML`
    content = re.sub(r'\.textContent(\s*=\s*[^;]*<svg)', r'.innerHTML\1', content)
    with open(f_name, "w") as f: f.write(content)
