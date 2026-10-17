import csv,json,re,sys,os
from pathlib import Path
from urllib.parse import urlsplit
sys.stdout.reconfigure(encoding='utf-8')
B=Path(__file__).resolve().parent
S=Path(r'C:\Users\admin\Documents\我在金英托联\项目\AI CPE\src')
OUT=B/'resource_catalog'; OUT.mkdir(exist_ok=True)
DEST=S/'00_系统总览与阅读导航'
raw=json.loads((B/'extracted_urls.json').read_text(encoding='utf-8'))
raw=[r for r in raw if Path(r['source']).suffix.lower()=='.pdf']
# Add the unwrapped Markdown URLs. They take precedence over PDF text line-join artefacts.
for root in [S/'90_原始SDK与参考仓库',Path(r'D:\BaiduNetdiskDownload\rknn\rknn\rknn3-model-zoo')]:
 for p in root.rglob('*.md'):
  if any(x.lower() in ['3rdparty','thirdparty','build','install','.git','node_modules'] for x in p.parts): continue
  try: t=p.read_text(encoding='utf-8-sig')
  except UnicodeError: continue
  for m in re.finditer(r'https?://[^\s<>\]"`]+',t):
   raw.append({'url':m.group(),'source':str(p),'page':None,'context':t[max(0,m.start()-100):m.end()+120]})

def clean(u):
 if not u.startswith(('http://','https://')): return None
 u=re.split(r'[\u3000-\u9fff“”]',u)[0].split(')')[0].rstrip('.,;:)*#\\')
 u=u.split(',')[0]
 cloud=re.match(r'(https?://console\.(?:box\.lenovo|zbox\.filez)\.com/l/[A-Za-z0-9]{6})',u)
 if cloud: u=cloud.group(1)
 if any(x in u for x in ['localhost','127.0.0.1','0.0.0.0','172.16.','<','>']): return None
 if '@' in urlsplit(u).netloc: return None
 if 'gerrit.' in u and 'repo-release/tools/' in u:
  for n in ['repo','script']:
   if '/tools/'+n in u: u=u.split('/tools/'+n)[0]+'/tools/'+n
 for ext in ['.tar.gz','.tar.xz','.caffemodel','.onnx','.zip','.tgz','.bin','.pt','.sh']:
  if ext in u and '/download/' in u or ext in u and any(d in u for d in ['dl.google.com','ftrg.','ftzr.','odroid','developer.arm.com']):
   end=u.find(ext)+len(ext)
   if end<len(u) and u[end].isalpha(): u=u[:end]
 return u if urlsplit(u).netloc else None
links={}
for row in raw:
 u=clean(row['url'])
 if not u: continue
 row={**row,'url':u}
 links.setdefault(u,[]).append(row)

def source_for(u,needle=None):
 xs=links.get(u,[])
 if needle: xs=[r for r in xs if needle in r['source']]
 if not xs: return None
 return sorted(xs,key=lambda r: ('_EN' in r['source'], '90_原始SDK' in r['source'], r['context']=='PDF hyperlink annotation',len(r['source'])))[0]
def local(p,label):
 p=Path(p)
 target=os.path.relpath(p,DEST).replace('\\','/') if p.drive.lower()==DEST.drive.lower() else p.as_uri()
 return f'[{label}](<{target}>)'
def cite(u,needle=None):
 row=source_for(u,needle)
 if not row: raise ValueError('Source missing '+u)
 return local(row['source'],Path(row['source']).name)+(f' 第{row["page"]}页' if row['page'] else '')

items=[]
def add(group,name,url,code,use,scope,needle=None):
 if url not in links: raise ValueError('URL not present in source: '+url)
 items.append(dict(group=group,name=name,url=url,code=code,use=use,scope=scope,source=cite(url,needle)))

add('系统、固件与接入','Android EVB10固件＋RK1828集成补丁','https://console.box.lenovo.com/l/t5dbts','未注明','update.img及RK1820_Android_patch；含Host集成参考','优先核对；仅EVB10参考，未确认适配实际主板及Android16','Quick_Start_For_Android_CN')
add('系统、固件与接入','EVB10通用快速验证固件入口','https://console.box.lenovo.com/l/7oOghG','未注明','主板预编译固件；文档还指明烧录工具和USB驱动在此网盘','仅EVB10；不可认定与Android专用入口内容相同','Quick_Start_CN')
add('系统、固件与接入','RK1820/RK1828固件与预编译部署包','https://console.box.lenovo.com/l/PHk0PF','未注明','算卡固件和Host部署资源；需按版型选择安装包','M.2/SODIMM/SODIMM-NET需匹配；Android集成优先看Android补丁包','Quick_Start_CN')
add('系统、固件与接入','Windows主机接入安装包','https://console.box.lenovo.com/l/boc8wj','vdwq','Windows直接接入RK1828的安装与验证资源','可选分支；不是Android主板系统','For_Windows_CN')
add('系统、固件与接入','完整RK182X AI SDK清单仓库','https://gerrit.rock-chips.com:8443/ai_coprocessor/manifests','需账号授权','repo清单入口，统一同步驱动、工具、应用等组件','需要源码集成时申请；不是公开压缩包直链','SDK_RELEASE_CN')
add('系统、固件与接入','Rockchip repo工具','https://gerrit.rock-chips.com:8443/repo-release/tools/repo','按账号权限','配套SDK多仓库同步工具','获授权后按发布说明使用','SDK_RELEASE_CN')
add('系统、固件与接入','Rockchip下载授权脚本仓库','https://gerrit.rock-chips.com:8443/repo-release/tools/script','需账号授权','Generate-Credential.x生成下载凭证','不是在线申请表；按供应商/FAE流程开通','SDK_RELEASE_CN')
add('模型工具与推理库','RKNN3工具、Runtime与服务','https://github.com/airockchip/rknn3-toolkit','公开仓库','RK1828模型转换、Android运行库、C API、服务组件','本地已有组件；不是实际板型完整BSP')
add('模型工具与推理库','RKNN3 Model Zoo','https://github.com/airockchip/rknn3-model-zoo','公开仓库','RK1828模型导出、转换、C++推理示例','本地D盘已有；按模型选择示例')
add('模型工具与推理库','RKNN3预转换模型集合','https://console.box.lenovo.com/l/H1fig1','rknn','已转换模型及配套文件，快速验证推理链路','文档记录rknn3_models/v1.1.0；具体模型内存与功能需实测')
add('模型工具与推理库','Qwen2.5-Omni-3B原始模型','https://huggingface.co/Qwen/Qwen2.5-Omni-3B','按模型许可','原始权重及配置；按D盘Omni示例导出Vision/Audio/LLM','业务模型候选；不等于现成RKNN或全功能语音输出')
add('模型工具与推理库','Omni示例指定Transformers源码版本','https://github.com/huggingface/transformers@v4.51.3-Qwen2.5-Omni-preview','公开源码依赖','pip使用git+此前缀安装；@后是版本引用，不是普通网页路径','仅复现该Omni示例时需要；原文说明与转换环境分开')
add('模型工具与推理库','Toolkit2及内含RKNPU2','https://github.com/airockchip/rknn-toolkit2','公开仓库','RK3588自带NPU转换工具和运行库','本地已有；仅使用RK1828时不必先走这条路')
add('模型工具与推理库','RK3588等平台Model Zoo','https://github.com/airockchip/rknn_model_zoo','公开仓库','RK3588自带NPU模型示例','本地已有；与RKNN3 Model Zoo不同')
add('模型工具与推理库','Toolkit2完整公开包／Docker环境','https://console.zbox.filez.com/l/I00fc3','rknn','Toolkit2包、Docker镜像等开发环境资源','开发电脑环境；不是主板系统镜像')
add('模型工具与推理库','Toolkit2 Model Zoo模型集合','https://console.zbox.filez.com/l/8ufwtG','rknn','RK3588等平台示例模型文件','与RK1828预转换模型集合分开')
add('图像处理与驱动','librga预编译库、头文件和示例','https://github.com/airockchip/librga','公开仓库','RK3588图像预处理','本地已有；不承担模型推理')
add('图像处理与驱动','librga源码／版本资源','https://console.zbox.filez.com/l/fuGojC','rkrga','按版本获取用户态RGA源码或库资源','仅需要编译或调整RGA版本时下载')
add('图像处理与驱动','RGA内核驱动源码','https://console.zbox.filez.com/l/7oOrKO','rkrga','更新主板RGA内核驱动','需匹配主板内核；不是RK1828 PCIe驱动')
add('图像处理与驱动','RGA模块配套更新包','https://console.zbox.filez.com/l/mu2SOR','rkrga','匹配更新RGA库与驱动','仅版本不匹配或需要升级时使用')
add('语音与业务应用资源','智能网关ASR数据包','https://console.zbox.filez.com/l/bocR0V','未注明','IntelliGate语音识别数据资源','业务参考；文档部署方式非Android16 APK直装方案','IntelliGate_Demo_CN')
add('语音与业务应用资源','智能网关TTS数据包','https://console.box.lenovo.com/l/4nijJi','未注明','IntelliGate语音合成数据资源','是否使用取决于语音方案与授权','IntelliGate_Demo_CN')
add('语音与业务应用资源','AI Meeting模型与版本耦合库','https://console.box.lenovo.com/l/9512tg','chzx','会议应用的模型与配套库，放入extra_unpack_model','应用参考；部分算法另需许可证','AI_Meeting_CN')
add('语音与业务应用资源','RKAUTH_TOOL授权工具','https://console.box.lenovo.com/l/e1v3pN','jula','Android Demo中OCR、翻译、TTS等指定模块授权工具','工具下载不等于获得license；联系业务申请','Introduction_Android_Demo_CN')
add('语音与业务应用资源','nanobot源工程','https://github.com/HKUDS/nanobot.git','公开仓库','智能网关Agent/MCP参考，文档要求固定提交并打补丁','可选；不是RK1828驱动','IntelliGate_Demo_CN')
add('开发电脑与编译工具','Rockchip通用交叉工具链','https://console.box.lenovo.com/l/EnyjVM','未注明','SDK构建用的交叉编译器集合','按文档/供应商指定版本选；Linux编译器不能替代Android NDK','Quick_Start_CN')
add('开发电脑与编译工具','Android NDK网盘入口','https://console.box.lenovo.com/l/e1v3Ny','未注明','Android C/C++ Demo构建工具','按实际Android16工程核对NDK版本','Quick_Start_CN')
add('开发电脑与编译工具','Android NDK r19c（Linux主机）','https://dl.google.com/android/repository/android-ndk-r19c-linux-x86_64.zip','无','参考示例使用的NDK版本','历史示例依赖；不表示Android16项目必须用r19c')
add('开发电脑与编译工具','ADB Platform Tools（Windows）','https://dl.google.com/android/repository/platform-tools-latest-windows.zip','无','ADB连接、推送文件、查看日志','包含ADB；不是Rockusb烧录驱动')
add('开发电脑与编译工具','Miniforge Python环境（Linux x86_64）','https://github.com/conda-forge/miniforge/releases/download/25.3.0-1/Miniforge3-25.3.0-1-Linux-x86_64.sh','无','创建Toolkit转换环境','开发电脑使用，不装到Android主板')
add('开发电脑与编译工具','RK182X RISC-V GCC','https://console.zbox.filez.com/l/103Dro','rknn','编译算卡侧自定义CPU算子／后处理插件','只有开发算卡侧插件时需要')
add('开发电脑与编译工具','AI Meeting GCC 10.3工具链','https://console.box.lenovo.com/l/j56Ytv','未注明','aarch64-rockchip1031-linux-gnu，会议Demo指定工具链','Linux会议应用参考；不是Android NDK','AI_Meeting_CN')
add('开发电脑与编译工具','Linux AArch64 GCC 6.3.1（Arm）','https://developer.arm.com/-/cdn-downloads/permalink/legacy-linaro-gnu-toolchains/6.3-2017.05/gcc-linaro-6.3.1-2017.05-x86_64_aarch64-linux-gnu.tar.xz','无','Linux C/C++ Demo交叉编译','Android APK用NDK；当前主路线可不下载')

sections=[]
for group in dict.fromkeys(i['group'] for i in items):
 sections.append('## '+group+'\n\n|资源与下载入口|提取码／权限|用途|适用条件|出处|\n|---|---|---|---|---|')
 for i in items:
  if i['group']==group:
   href=i['url'].replace('github.com/huggingface/transformers@','github.com/huggingface/transformers/tree/')
   sections.append(f'|[{i["name"]}]({href})|{i["code"]}|{i["use"]}|{i["scope"]}|{i["source"]}|')
 sections.append('')

# All candidate models (not all are required for the project).
modelrows=[]
for u,occ in sorted(links.items()):
 if not any(d in u for d in ['huggingface.co/','modelscope.cn/','ftrg.zbox.filez.com/','meta.zbox.filez.com/','paddleocr.bj.bcebos.com/','s3.amazonaws.com/onnx-model-zoo/']): continue
 if any(x in u for x in ['huggingface.co/docs','huggingface.co/blog','modelscope.cn/docs']): continue
 r=source_for(u)
 # Prefer a non-joined Markdown match. Exclude visibly broken Markdown/footer fragments.
 if any(x in u for x in ['**',')(', 'Download','。','，']): continue
 desc='模型候选/配套资源；按业务选型下载，不是全部必需'
 scope='RK1828示例' if ('D:\\' in r['source'] or 'RK1828' in r['source'] or 'rknn3' in r['source']) else 'RK3588等平台示例'
 modelrows.append({'url':u,'scope':scope,'description':desc,'source':r['source'],'page':r['page'] or '', 'context':re.sub(r'\s+',' ',r['context'])[:500]})
def write_csv(name,rows,fields):
 with (OUT/name).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
write_csv('项目资源下载清单.csv',[{k:i[k] for k in ['group','name','url','code','use','scope','source']} for i in items],['group','name','url','code','use','scope','source'])
write_csv('模型资源链接附表.csv',modelrows,['url','scope','description','source','page','context'])
audit=[]
for u,occ in sorted(links.items()):
 r=source_for(u)
 audit.append({'url':u,'source':r['source'],'page':r['page'] or '', 'context':re.sub(r'\s+',' ',r['context'])[:600],'note':'文档提及的外部链接；可能是说明、依赖、历史平台或模型候选，不代表本项目必须下载'})
write_csv('文档外部链接审计附表.csv',audit,['url','source','page','context','note'])
text='''# 本项目资源下载链接清单

适用目标：RK3588 Android 16主板控制RK1828，完成模型推理及音视频应用开发。

本清单从现有资料中提取链接，没有下载资源包。项目主清单区分核心入口和条件性资源；模型候选另外列出，避免误解为所有模型都必须下载。

本轮扫描87份去重后的PDF及511份文本说明（含中英文、SDK说明、D盘Model Zoo说明；排除第三方依赖和构建产物目录下的文本）。同一资源去重。主清单逐条标明文件名、页码和用途；PDF文本断行导致的URL污染按实际超链接和同文档重复入口校正。

## 先看这四项

1. [Android EVB10固件＋RK1828集成补丁](https://console.box.lenovo.com/l/t5dbts)：是Android专用参考入口，文档指出内含update.img和RK1820_Android_patch。不是当前主板Android16兼容性的证明。
2. [RK1828固件与部署包](https://console.box.lenovo.com/l/PHk0PF)：先确认算卡版型及Host系统。
3. [RKNN3公开工具与运行库](https://github.com/airockchip/rknn3-toolkit)：本地已收集对应组件。
4. [预转换RKNN3模型](https://console.box.lenovo.com/l/H1fig1)，提取码rknn：用于先跑通模型链路。

## 下载状态说明

- 网盘链接属于“原文明确提供”；本次网页检索工具无法读取所检查网盘的目录内容，不能确认分享是否有效、具体文件是否齐全或当前可下载。
- GitHub公开仓库入口可用于获取组件，不等于完整源码全部开源或Android16已适配；许可证以各资源实际条款为准。
- 公司代码服务器需要授权；不是SDK申请表地址。
- 只需供应商出厂系统使用算卡时，先索取已适配的运行环境，不必把所有条件性开发工具都下载。

'''+ '\n'.join(sections)+f'''
## 模型候选与完整追溯

- [模型资源链接附表](模型资源链接附表.csv)：{len(modelrows)}条候选链接，包含模型主页、原始权重/ONNX和部分配套资源；每项保留出处与原文上下文。选定模型后才需要相应下载。
- [项目主清单CSV](项目资源下载清单.csv)：{len(items)}个已人工分类的项目资源入口。
- [文档外部链接审计附表](文档外部链接审计附表.csv)：{len(audit)}条去重后的外部链接，供追溯遗漏；其中包含论文、官网、说明和历史平台，不应全当下载任务。

## 文档没有给出、仍需供应商提供的资源

|缺口|需要什么|
|---|---|
|实际主板Android16镜像与BSP|按厂家、板型、硬件版本获取，现有EVB10入口不能代替|
|实际主板RK1828 PCIe驱动及Android16集成|匹配内核的驱动/补丁、SELinux、init服务、Runtime组合；没有发现本项目板型的独立公开直链|
|Android推理调用APK/中间件完整配套|Android文档指出位于补丁包内，确认具体包及签名、权限和接口；不能将公开C API直接等同于已集成APK|
|摄像头/麦克风/喇叭适配包与示例|具体外设型号对应的驱动、HAL、音频路由及可运行APK；现有文档未给出本主板的专用下载链接|
|完整业务应用源码/交付包|AI Meeting、App Portal、IntelliGate等文档常引用完整SDK内部applications目录；数据包入口不等于应用源码入口|

## 其他边界

- `RKDevTool_Release_v3.37`与`DriverAssitant_v5.13`：以太网指南第4页明确写在EVB10固件网盘内，没有提供独立直链。通过上表EVB10入口查找，使用版本由主板供应商确认。
- OCR/翻译/TTS等指定官方Demo模块可能需要额外license；RKAUTH_TOOL只是授权工具，不是许可证本身。
- AI Meeting、IntelliGate和DEB/systemd应用资料主要作为Linux业务参考；资源存在不代表能直接安装到Android16。
- Toolkit2/RKNPU2用于RK3588自带NPU，RKNN3用于RK1828，勿混用模型或运行库。
'''
(OUT/'项目资源下载链接清单.md').write_text(text,encoding='utf-8-sig')
(B/'catalog_summary.json').write_text(json.dumps({'curated_resources':len(items),'model_candidate_urls':len(modelrows),'audit_urls':len(audit),'outputs':[p.name for p in OUT.iterdir()]},ensure_ascii=False,indent=2),encoding='utf-8')
print((B/'catalog_summary.json').read_text(encoding='utf-8'))
