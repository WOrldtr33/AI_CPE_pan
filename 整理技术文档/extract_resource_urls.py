import sys,re,json,hashlib,unicodedata
from pathlib import Path
from pypdf import PdfReader
sys.stdout.reconfigure(encoding='utf-8')
base=Path(__file__).resolve().parent
src=Path(r'C:\Users\admin\Documents\我在金英托联\项目\AI CPE\src')
zoo=Path(r'D:\BaiduNetdiskDownload\rknn\rknn\rknn3-model-zoo')
rows=[]
def extract(text,path,page):
 text=unicodedata.normalize('NFKC',text).replace('\x01','')
 # PDF line wraps frequently split URLs after slash, hyphen, or inside known URL tokens.
 text=re.sub(r'(https?://[^\s<>\]"\u3000]+)\n(?=[A-Za-z0-9_/?=&.%#-])',r'\1',text)
 for m in re.finditer(r'https?://[^\s<>\]"\u3000]+',text):
  url=m.group().rstrip('.,;:)，。；`*')
  rows.append({'url':url,'source':str(path),'page':page,'context':text[max(0,m.start()-180):m.end()+230]})
seen=set(); pdfcount=0
for p in src.rglob('*.pdf'):
 if '历史空目录' in str(p): continue
 h=hashlib.sha256(p.read_bytes()).hexdigest()
 if h in seen: continue
 seen.add(h); pdfcount+=1
 try:
  reader=PdfReader(p)
  for i,page in enumerate(reader.pages):
   extract(page.extract_text() or '',p,i+1)
   for ref in page.get('/Annots',[]):
    a=ref.get_object().get('/A',{})
    if a and a.get('/URI'):
     rows.append({'url':str(a['/URI']),'source':str(p),'page':i+1,'context':'PDF hyperlink annotation'})
 except Exception as e:
  print('ERROR',str(p),str(e),flush=True)
 if pdfcount%10==0: print('PDFs processed',pdfcount,flush=True)
mdcount=0
for root in [src/'90_原始SDK与参考仓库',zoo]:
 for p in root.rglob('*'):
  if not p.is_file() or p.suffix.lower() not in ['.md','.txt']: continue
  if any(x.lower() in ['3rdparty','thirdparty','build','install','.git','node_modules'] for x in p.parts): continue
  if p.suffix.lower()=='.txt' and 'requirements' in p.name.lower(): continue
  try: extract(p.read_text(encoding='utf-8-sig'),p,None); mdcount+=1
  except (UnicodeError,OSError): pass
(base/'extracted_urls.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'unique_pdf_files':pdfcount,'text_docs':mdcount,'url_occurrences':len(rows),'unique_urls':len(set(r['url'] for r in rows))},ensure_ascii=False),flush=True)
