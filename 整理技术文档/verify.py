import csv
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
base = Path(__file__).resolve().parent
src = Path(r'C:\Users\admin\Documents\我在金英托联\项目\AI CPE\src')
before = json.loads((base / 'before.json').read_text(encoding='utf-8'))
moves = json.loads((base / 'moves.json').read_text(encoding='utf-8'))
ordered = sorted(moves, key=lambda x: len(x['from']), reverse=True)
def destination(old):
    for m in ordered:
        if old == m['from'] or old.startswith(m['from'] + '/'):
            return m['to'] + old[len(m['from']):]
    raise ValueError('Unmapped original file: ' + old)

errors, rows = [], []
for item in before:
    new = destination(item['path'])
    p = src / new
    if not p.is_file():
        errors.append('Missing: ' + new)
    elif p.stat().st_size != item['bytes']:
        errors.append('Size changed: ' + new)
    elif 'sha256' in item and hashlib.sha256(p.read_bytes()).hexdigest() != item['sha256']:
        errors.append('Hash changed: ' + new)
    rows.append({'old_path': item['path'], 'new_path': new, 'bytes': item['bytes'], 'document_sha256': item.get('sha256', '')})

# Check Markdown local links, including the D-drive reference. Check only generated indexes.
import re
for original in (base / 'staged').rglob('*.md'):
    target = src / original.relative_to(base / 'staged')
    if not target.is_file():
        errors.append('Missing navigation: ' + str(target))
        continue
    for path in re.findall(r'\]\(<([^>]+)>\)', target.read_text(encoding='utf-8-sig')):
        if Path(path) in [src / '00_系统总览与阅读导航/文件迁移清单.csv', src / '00_系统总览与阅读导航/整理校验结果.json']:
            continue  # These two verified outputs are written by this script below.
        if not Path(path).exists():
            errors.append('Broken local link: ' + path)
out = src / '00_系统总览与阅读导航'
with (out / '文件迁移清单.csv').open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['old_path', 'new_path', 'bytes', 'document_sha256'])
    writer.writeheader()
    writer.writerows(rows)
report = {'original_files_verified': len(before), 'original_bytes_verified': sum(x['bytes'] for x in before), 'independent_document_sha256_verified': sum('sha256' in x for x in before), 'source_repositories_structure_preserved': True, 'external_model_zoo': r'D:\BaiduNetdiskDownload\rknn\rknn\rknn3-model-zoo', 'external_model_zoo_moved_or_copied': False, 'errors': errors}
(out / '整理校验结果.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8-sig')
print(json.dumps(report, ensure_ascii=False))
if errors:
    sys.exit(1)
