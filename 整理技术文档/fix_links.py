import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit, unquote

sys.stdout.reconfigure(encoding='utf-8')
base = Path(__file__).resolve().parent
src = Path(r'C:\Users\admin\Documents\我在金英托联\项目\AI CPE\src')
out = base / 'linkfix'
backup = base / 'before_linkfix'
generated = {}
index_paths = {}

def readme_for(p):
    for name in ['README_CN.md', 'README.md', 'readme.md', 'README_EN.md']:
        if (p / name).is_file():
            return p / name
    return None

def reference(target, parent):
    if target.drive.lower() == parent.drive.lower():
        return os.path.relpath(target, parent).replace('\\', '/')
    return target.as_uri()

def directory_index(folder):
    key = str(folder)
    if key in index_paths:
        return index_paths[key]
    suffix = hashlib.sha256(key.encode()).hexdigest()[:8]
    rel = Path('00_系统总览与阅读导航') / '目录索引' / (folder.name + '_' + suffix + '.md')
    index_paths[key] = src / rel
    text = '# ' + folder.name + '\n\n原目录：`' + str(folder) + '`\n\n'
    subs = sorted(p.name for p in folder.iterdir() if p.is_dir())
    if subs:
        text += '子目录：\n\n' + '\n'.join('- `' + n + '`' for n in subs) + '\n\n'
    files = sorted(p for p in folder.iterdir() if p.is_file())
    guides = sorted(p for p in folder.rglob('*.md') if p.parent != folder and p.name.lower().startswith('readme'))
    if files:
        text += '目录内文件：\n\n' + '\n'.join('- [' + p.name + '](<' + reference(p, (src/rel).parent) + '>)' for p in files) + '\n\n'
    if guides:
        text += '各示例说明：\n\n' + '\n'.join('- [' + p.relative_to(folder).as_posix() + '](<' + reference(p, (src/rel).parent) + '>)' for p in guides) + '\n'
    generated[rel] = text
    return src / rel

changes = []
for old in (base / 'staged').rglob('*.md'):
    rel = old.relative_to(base / 'staged')
    actual = src / rel
    original = actual.read_text(encoding='utf-8-sig')
    def replace(m):
        target = Path(m.group(1))
        if target.is_dir():
            target = readme_for(target) or directory_index(target)
        return '](<' + reference(target, actual.parent) + '>)'
    updated = re.sub(r'\]\(<([CD]:/[^>]+)>\)', replace, original)
    if updated != original:
        b = backup / rel
        b.parent.mkdir(parents=True, exist_ok=True)
        b.write_bytes(actual.read_bytes())
        generated[rel] = updated
        changes.append({'relative': rel.as_posix(), 'before_sha256': hashlib.sha256(actual.read_bytes()).hexdigest()})

errors = []
count = 0
for rel, text in generated.items():
    for value in re.findall(r'\]\(<([^>]+)>\)', text):
        count += 1
        if value.startswith('file:///'):
            target = Path(unquote(urlsplit(value).path).lstrip('/'))
        elif '://' in value:
            continue
        else:
            target = (src / rel).parent / value
        target = target.resolve()
        if not target.is_file() and target not in [(src / r).resolve() for r in generated]:
            errors.append(str(target))
for rel, text in generated.items():
    p = out / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8-sig')
(base/'linkfix_plan.json').write_text(json.dumps({'changes': changes, 'outputs': [r.as_posix() for r in generated]}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'updated_navigation_files': len(changes), 'new_directory_indexes': len(index_paths), 'checked_local_file_links': count, 'errors': errors}, ensure_ascii=False))
if errors:
    sys.exit(1)
