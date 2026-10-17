import json
import hashlib
from pathlib import Path

BASE = Path(__file__).resolve().parent
SRC = Path(r'C:\Users\admin\Documents\我在金英托联\项目\AI CPE\src')
STAGE = BASE / 'staged'
STAGE.mkdir(exist_ok=True)
RAW = '90_原始SDK与参考仓库'
NAV = '00_系统总览与阅读导航'
HOST = '01_RK3588主板'
DEV = '02_RK1828协处理器'
CO = '03_主板与协处理器协同'
T2 = f'{RAW}/RK3588/rknn-toolkit2-master'
Z2 = f'{RAW}/RK3588/rknn_model_zoo-main'
RGA = f'{RAW}/RK3588/librga-main'
T3 = f'{RAW}/RK1828/rknn3(面向专用AI协处理器)'
EXTERNAL = Path(r'D:\BaiduNetdiskDownload\rknn\rknn\rknn3-model-zoo')
assert EXTERNAL.is_dir()
moves = []
def move(a, b):
    moves.append({'from': a, 'to': b})

for name, target in [
    ('rknn-toolkit2-master', T2), ('rknn_model_zoo-main', Z2),
    ('librga-main', RGA), ('rknn3(面向专用AI协处理器)', T3),
    ('openclaw_dev-main', f'{RAW}/应用参考/openclaw_dev-main')]:
    move(name, target)
for p in sorted(SRC.glob('*.zip')):
    move(p.name, f'{RAW}/原始压缩包/{p.name}')

groups = {
 'Release/Rockchip_RK1820_RK1828_AI_SDK_RELEASE': f'{NAV}/01_SDK组成与版本',
 'Release/Rockchip_RK1820_RK1828_AI_SDK_Quick_Start': f'{CO}/01_整体接入与快速验证',
 'Release/Rockchip_RK1820_RK1828_AI_SDK_Quick_Start_For_Android': f'{CO}/02_Android主控集成',
 'Develop/Rockchip_RK1820_RK1828_AI_SDK_Quick_Start_For_Windows': f'{DEV}/01_主机接入_Windows参考',
 'Develop/Rockchip_RK1820_RK1828_Develop_Guide_PCBA': f'{DEV}/05_产测与量产安全',
 'Develop/Rockchip_RK1820_RK1828_User_Guide_Ethernet': f'{CO}/03_以太网接入',
 'Develop/Rockchip_RK1820_RK1828_User_Guide_SecureBoot': f'{DEV}/05_产测与量产安全',
 'Tools/Rockchip_User_Guide_RKNN-SMI_Tool': f'{DEV}/04_设备管理与故障诊断',
 'Examples/Rockchip_Developer_Guide_RKNN_GStreamer_Plugins': f'{CO}/05_视频流水线与插件',
 'Examples/Rockchip_Developer_Guide_RKNN_Rockit_DEMO': f'{CO}/05_视频流水线与插件',
 'Examples/Rockchip_User_Guide_AI_Hub_Benchmark': f'{CO}/07_模型测试与性能验证',
 'Examples/Rockchip_User_Guide_RKNN_RKLLM3_Server_DEMO': f'{CO}/06_大模型服务与接口',
 'Examples/Rockchip_User_Guide_RK1820_RK1828_Applications': f'{CO}/08_业务应用与交付',
 'Applications/Rockchip_RK1820_RK1828_User_Guide_Applications': f'{CO}/08_业务应用与交付',
 'Applications/Rockchip_Developer_Guide_AI_Media_Base': f'{CO}/08_业务应用与交付',
 'Applications/Rockchip_Developer_Guide_AI_Meeting': f'{CO}/08_业务应用与交付',
 'Applications/Rockchip_Developer_Guide_App_Portal': f'{CO}/08_业务应用与交付',
 'Applications/Rockchip_Developer_Guide_IntelliGate_Demo': f'{CO}/08_业务应用与交付',
 'Applications/Rockchip_Developer_Guide_Multistream_Detect': f'{CO}/08_业务应用与交付',
 'Applications/Rockchip_RK1820_RK1828_Introduction_Android_Demo': f'{CO}/02_Android主控集成',
 'Applications/Rockchip_RK1820_RK1828_User_Guide_Llama_RKNN3_Server': f'{CO}/06_大模型服务与接口',
 'Others/Rockchip_User_Guide_SDK_Application_And_Synchronization': f'{NAV}/02_SDK申请与资源来源',
}
docs = list((SRC / 'docs_rk1828').rglob('*'))
for p in sorted(x for x in docs if x.is_file()):
    rel = p.relative_to(SRC / 'docs_rk1828').as_posix()
    if p.suffix == '.md':
        target = f'{NAV}/01_SDK组成与版本'
    else:
        key = rel[:-7]  # remove _CN.pdf / _EN.pdf
        target = groups[key]
    move('docs_rk1828/' + rel, target + '/' + p.name)
for name in ['docs_rk1828', '整理的', 'rknn2(面向通用SoC芯片)']:
    move(name, f'{RAW}/历史空目录/{name}')

def link(rel, label=None):
    return f'[{label or Path(rel).name}](<{(SRC / rel).as_posix()}>)'
def external_link(rel='', label='D盘 RKNN3 Model Zoo'):
    return f'[{label}](<{(EXTERNAL / rel).as_posix()}>)'
def doc(prefix):
    for item in moves:
        if item['from'].startswith('docs_rk1828/' + prefix) and item['from'].endswith('_CN.pdf'):
            return link(item['to'])
    raise ValueError(prefix)
def write(rel, text):
    p = STAGE / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text.rstrip() + '\n', encoding='utf-8-sig')
def index(folder, intro, refs=(), extra=''):
    entries = [f'- {x}' for x in refs]
    local = [x for x in moves if x['to'].startswith(folder + '/') and x['to'].endswith('_CN.pdf')]
    entries += [f'- {link(x["to"])}' for x in local]
    write(folder + '/README.md', '# ' + folder.split('/')[-1] + '\n\n' + intro + '\n\n' + '\n'.join(entries) + '\n\n' + extra)

index(f'{NAV}/01_SDK组成与版本', '先阅读发布说明，认识完整 RK182X SDK 与 RKNN3 工具链的关系。更新日志列出各版本的驱动、固件、工具和应用变化。')
index(f'{NAV}/02_SDK申请与资源来源', 'SDK 申请、授权与同步参考。已知云端入口另见上一级“资源来源与待确认事项.md”。')
index(f'{HOST}/01_系统镜像与烧录', '当前目标：供应商主板支持 Android 16。主板厂家、型号、硬件版本、匹配镜像、烧录工具版本及操作步骤待供应商确认。',
      [doc('Release/Rockchip_RK1820_RK1828_AI_SDK_Quick_Start')],
      '上述综合指南第11—12页提供 RK3588 EVB10 固件入口和简要烧录说明；这只能作为 EVB10 参考，不能证明适配当前主板或 Android 16。这里暂不放置未经确认的镜像。')
index(f'{HOST}/02_开发环境与工具安装', '先准备模型转换电脑环境，再准备 Android 应用编译环境。SDK、NDK 和驱动版本应按实际主板与供应商资料确认。',
      [link(f'{T2}/README.md'), link(f'{T2}/doc/CN/01_RKNN2_SDK_快速入门_V2.5.0.pdf'), link(f'{T2}/doc/CN/WSL中使用RKNN_ToolKit2.md'), link(f'{Z2}/docs/Compilation_Environment_Setup_Guide.md')])
index(f'{HOST}/03_自带NPU模型转换与部署', '这条流程使用 RK3588 自带 NPU，采用 Toolkit2 / RKNPU2；与外接 RK1828 的 RKNN3 路径分开。rknpu2 已包含在 Toolkit2 仓库内。',
      [link(f'{T2}/doc/CN/02_RKNN2_SDK_开发指南_V2.5.0.pdf'), link(f'{T2}/doc/CN/03_RKNN2_Toolkit_Python_API参考_V2.5.0.pdf'), link(f'{T2}/doc/CN/05_RKNN2_Runtime_C_API_参考_V2.5.0.pdf'), link(f'{T2}/rknpu2'), link(f'{Z2}/README_CN.md'), link(f'{Z2}/examples')])
index(f'{HOST}/04_RGA图像预处理', 'RGA 负责图像缩放、裁剪、旋转、格式转换等，不负责模型推理。视觉流程可使用主板 RGA 处理输入，再送入主板 NPU 或 RK1828。',
      [link(f'{RGA}/docs/Rockchip_Developer_Guide_RGA_CN.md'), link(f'{RGA}/docs/Rockchip_FAQ_RGA_CN.md'), link(f'{RGA}/samples')],
      'Markdown 指南依赖同仓库的图片与资源目录，保留原位置，通过此索引进入。')
index(f'{HOST}/05_应用运行参考', '现有 OpenClaw Kiosk 工程 README 面向 Debian（Linaro），包含 Chromium、systemd、音频和摄像头服务。它是应用架构参考，不能直接视为 Android 16 的部署教程。',
      [link(f'{RAW}/应用参考/openclaw_dev-main/README.md')])
index(f'{DEV}/01_主机接入_Windows参考', '这是 Windows 主机通过 USB / PCIe 使用 RK1828 的另一条路线；当前 Android 主板路线优先看“主板与协处理器协同”。')
index(f'{DEV}/02_固件与启动升级', '区分主板 Android 系统镜像和 RK1828 算卡固件：二者不是同一个文件。RK182X 以太网方案使用扩展板 eMMC 固件；文档说明 PCIe/USB 方案可由 Host 向算卡 DRAM 推送固件启动。',
      [doc('Release/Rockchip_RK1820_RK1828_AI_SDK_Quick_Start'), doc('Develop/Rockchip_RK1820_RK1828_User_Guide_Ethernet'), doc('Develop/Rockchip_RK1820_RK1828_User_Guide_SecureBoot')],
      '这里通过链接引用综合指南，避免复制同一 PDF。固件与安装包云端入口见资源来源表。')
index(f'{DEV}/03_RKNN3模型转换', '在支持的开发电脑环境中导出 ONNX、配置量化并转换为 RK1828 使用的 RKNN 模型，再交给主板侧 Runtime 部署。脚本中目标平台需核对 rk1828，不能直接沿用示例默认 rk1820。',
      [link(f'{T3}/rknn3-toolkit/README_CN.md'), link(f'{T3}/rknn3-toolkit/doc/CN/02_RKNN3_SDK_开发指南_V1.1.0.pdf'), link(f'{T3}/rknn3-toolkit/doc/CN/03_RKNN3_Toolkit_Python_API_参考_V1.1.0.pdf'), link(f'{T3}/rknn3-toolkit/rknn3-toolkit/examples'), external_link('README_CN.md'), external_link('examples', 'D盘模型转换与部署示例')],
      'RKNN3 Model Zoo 保留在 D 盘原位，没有复制或移动约19.5 GiB的数据。')
index(f'{DEV}/04_设备管理与故障诊断', '用于确认设备是否在线、版本是否匹配，以及查看温度、频率、内存、功耗、日志、复位和休眠唤醒状态。')
index(f'{DEV}/05_产测与量产安全', 'PCBA 文档是产线测试指南，不是电路板设计指南。SecureBoot 文档涉及密钥、签名、OTP、安全启动和防抄板，属于量产阶段。')
index(f'{CO}/01_整体接入与快速验证', '整体路线：主板系统可用 → 算卡连接 → Host 驱动与服务安装 → 识别设备 → 加载模型推理。综合指南兼有 Linux / 固件 / 模型 / 管理内容，可从其他步骤交叉引用。')
index(f'{CO}/02_Android主控集成', '当前项目主板支持 Android 16。这里的文档讲为接入 RK1828 而进行的 kernel / Android 集成和 Demo 集成；具体补丁、内核、SELinux 与 APK 适配仍需按 Android 16 版本核对，不应假定示例原样可用。')
index(f'{CO}/03_以太网接入', '仅选择以太网连接时阅读：扩展板固件、硬件拨码、IP、mDNS、传输代理及网络推理。PCIe / USB 主路线无需先完成此分支。')
index(f'{CO}/04_Runtime与推理接口', '主板运行应用，通过 RKNN3 Runtime 和通信服务调度 RK1828。此阶段不再重新训练或转换模型。',
      [link(f'{T3}/rknn3-runtime/README_CN.md'), link(f'{T3}/rknn3-runtime/examples/rknn3_model_test_demo/README_CN.md'), link(f'{T3}/rknn3-runtime/examples/rknn3_session_test_demo/README_CN.md'), link(f'{T3}/rknn3-toolkit/doc/CN/05_RKNN3_Runtime_C_API_参考_V1.1.0.pdf'), link(f'{T3}/rknn3-toolkit/doc/CN/04_RKNN3_Toolkit_Lite_Python_API_参考_V1.1.0.pdf')])
index(f'{CO}/05_视频流水线与插件', '用于连接视频输入、解码、图像预处理、RKNN推理、后处理和结果显示。主板处理媒体与业务，算卡执行分配给它的推理任务。',
      [link(f'{T3}/rknn-gstreamer-plugins')])
index(f'{CO}/06_大模型服务与接口', '先完成算卡识别与模型准备，再部署 RKLLM3 服务，最后测试 HTTP / OpenAI 兼容接口及网页。',
      [link(f'{T3}/rknn3-runtime/rkllm3-server/README_CN.md')])
index(f'{CO}/07_模型测试与性能验证', '用于完成最小推理验证后，比较模型结果、性能和应用功能。',
      [link(f'{T3}/rknn3-runtime/examples/rknn3_model_test_demo/README_CN.md'), external_link('tools', 'D盘 Model Zoo 评测工具')])
index(f'{CO}/08_业务应用与交付', '应用层参考：多路视频、媒体分析、会议、智能网关和应用交付。部分示例使用 Debian、systemd 或 DEB，不能直接等同于 Android 16 部署步骤。')

for parent, description in [(NAV, '系统总览、版本、资源与迁移记录'), (HOST, '主板系统、内置NPU和图像处理'), (DEV, '算卡固件、RKNN3转换、管理与量产'), (CO, '主板与算卡连接、驱动、接口及业务运行')]:
    children = sorted(p.parent.relative_to(STAGE).as_posix() for p in (STAGE / parent).rglob('README.md'))
    write(parent + '/README.md', '# ' + parent + '\n\n' + description + '\n\n' + '\n'.join('- ' + link(x + '/README.md', x.split('/')[-1]) for x in children))

write('README.md', f'''# RK3588 + RK1828 技术资料入口

按硬件角色和实施过程整理。当前主板系统目标为 Android 16；主板板型、匹配镜像、烧录工具与教程待供应商确认。

1. {link(NAV + '/系统运行过程与阅读路线.md', '先看：系统运行过程与阅读路线')}
2. {link(NAV + '/资源来源与待确认事项.md', '资源位置、云端来源与待确认事项')}
3. {link(HOST, 'RK3588主板：系统、开发环境、自带NPU、RGA')}
4. {link(DEV, 'RK1828协处理器：固件、模型转换、设备管理、量产')}
5. {link(CO, '主板与协处理器协同：连接、Android集成、Runtime与应用')}
6. {link(RAW, '原始SDK与参考仓库')}

源码、SDK和压缩包保留内部结构与原名；独立PDF按过程归类，中英文版放在一起。每个过程目录的README说明适用范围并链接到原仓库文档。

RKNN3 Model Zoo 位于 {external_link()}，保留原位。

文件旧路径与新路径见 {link(NAV + '/文件迁移清单.csv', '文件迁移清单')}。移动后的文件数量、大小以及独立文档哈希校验见 {link(NAV + '/整理校验结果.json', '整理校验结果')}。
''')
write(NAV + '/系统运行过程与阅读路线.md', f'''# 系统运行过程与阅读路线

## 先区分两条推理路径

| 路径 | 模型转换 | 应用与推理 |
|---|---|---|
| RK3588自带NPU | 开发电脑使用Toolkit2转换 | RK3588应用通过RKNPU2调用内置NPU |
| RK1828协处理器 | 开发电脑使用RKNN3 Toolkit转换 | RK3588应用通过RKNN3 Runtime及通信服务调度RK1828 |

图像处理可由RK3588的RGA完成；视频编解码与业务调度属于主板侧工作。RK1828承担指定模型的推理任务。具体任务分配以应用实现为准。

## 按实施顺序阅读

| 步骤 | 要完成的事 | 资料入口 | 完成标志 |
|---|---|---|---|
| 1 | 确认板型、Android16镜像及烧录步骤 | {link(HOST+'/01_系统镜像与烧录/README.md', '系统镜像与烧录')} | 主板系统启动，版本与外设核对通过 |
| 2 | 准备电脑转换与应用编译环境 | {link(HOST+'/02_开发环境与工具安装/README.md', '开发环境')} | Toolkit导入和工具链检查通过 |
| 3 | 连接RK1828，准备匹配固件 | {link(CO+'/01_整体接入与快速验证/README.md', '整体接入')} / {link(DEV+'/02_固件与启动升级/README.md', '算卡固件')} | Host能够识别算卡 |
| 4 | 安装Host驱动、通信服务与Runtime | {link(CO+'/02_Android主控集成/README.md', 'Android集成')} / {link(CO+'/04_Runtime与推理接口/README.md', 'Runtime')} | 设备列表、版本与服务检查通过 |
| 5A | 转换RK1828模型 | {link(DEV+'/03_RKNN3模型转换/README.md', 'RKNN3模型转换')} | 目标平台正确，模型及配套权重准备完成 |
| 5B | 如使用主板自带NPU，走独立转换路线 | {link(HOST+'/03_自带NPU模型转换与部署/README.md', 'Toolkit2路线')} | RK3588模型转换和部署完成 |
| 6 | 做最小推理与结果验证 | {link(CO+'/07_模型测试与性能验证/README.md', '测试验证')} | 测试模型推理成功，结果可检查 |
| 7 | 按业务选择视频或大模型接口 | {link(CO+'/05_视频流水线与插件/README.md', '视频')} / {link(CO+'/06_大模型服务与接口/README.md', '大模型服务')} | 应用端到端运行 |
| 8 | 再看业务交付、运维与量产 | {link(CO+'/08_业务应用与交付/README.md', '应用交付')} / {link(DEV+'/05_产测与量产安全/README.md', '量产')} | 按项目需要验证 |

以太网接入与Windows主机是可选分支，按实际连接和主机平台选择，不是所有路线都必须经过。

## 综合文档怎样读

PDF不拆页。综合快速入门保留一份，其他步骤通过README引用。原SDK内部文档、Markdown图片资源和构建脚本保留原有相对位置。
''')
write(NAV + '/资源来源与待确认事项.md', f'''# 资源来源与待确认事项

## 本地资源

| 资源 | 位置 |
|---|---|
| RK3588 Toolkit2及内含RKNPU2 | {link(T2)} |
| RK3588等平台模型示例 | {link(Z2)} |
| RGA库、头文件、指南及示例 | {link(RGA)} |
| RK1828 Toolkit、Runtime、GStreamer插件 | {link(T3)} |
| RKNN3 Model Zoo | {external_link()}；D盘原位，没有复制 |
| 原始下载压缩包 | {link(RAW+'/原始压缩包')}；保留，没有删除 |

## 文档已提供的云端入口

以下为先前已核对的文档记录，本次整理未重新验证网盘权限、内容和有效期。

| 资源 | 文档记录的入口 | 适用范围与限制 |
|---|---|---|
| RK3588 EVB10预编译固件 | [下载入口](https://console.box.lenovo.com/l/7oOghG) | EVB10；尚未确认当前主板适配性及Android16版本 |
| RK1820/RK1828预编译软件安装包 | [下载入口](https://console.box.lenovo.com/l/PHk0PF) | 需匹配M.2、SODIMM或SODIMM-NET版型 |
| 预转换RKNN3模型 | [下载入口](https://console.box.lenovo.com/l/H1fig1)，提取码rknn | 文档记录模型位于rknn3_models/v1.1.0 |
| RK3588工具链 | [Toolkit2仓库](https://github.com/airockchip/rknn-toolkit2) | 与RKNN3分开；RKNPU2在此仓库内 |
| 模型示例 | [Model Zoo仓库](https://github.com/airockchip/rknn_model_zoo) | 与RKNN3 Model Zoo不同 |
| 图像处理 | [librga仓库](https://github.com/airockchip/librga) | 图像处理，不是模型推理 |

云端固件与安装包证据：{doc('Release/Rockchip_RK1820_RK1828_AI_SDK_Quick_Start')} 第11—12页；{doc('Develop/Rockchip_RK1820_RK1828_User_Guide_Ethernet')} 第4页还说明烧录工具与USB驱动在EVB10固件网盘内。

## 待供应商确认

- 主板厂家、准确型号、硬件版本、存储配置。
- 与该主板匹配的Android16完整系统镜像、校验值及版本说明。
- 烧录工具与USB驱动版本、烧录口、按键和Loader/Maskrom进入步骤。
- Android16 BSP/内核与RK1828驱动、Runtime、SELinux及应用的匹配关系。
- 实际RK1828模组版型与连接方式、对应固件和部署包。

本地拥有文档或知道云端入口，不代表完整驱动、固件、安装包及适配已经全部就绪。
''')
write(RAW + '/README.md', '# 原始SDK与参考仓库\n\n完整保留源码、SDK及原始压缩包内部结构。独立文档按实施流程归类；原始docs文档包保留在“原始压缩包/docs(1828).zip”。\n\nD盘RKNN3 Model Zoo保持原位：' + external_link() + '\n\n“历史空目录”保留原本的空目录及独立PDF迁移后的空目录结构，未删除原有文件。\n')
write(RAW + '/RK1828/RKNN3_Model_Zoo_位置.md', '# RKNN3 Model Zoo 外部位置\n\n' + external_link('README_CN.md') + '\n\n路径：`' + str(EXTERNAL) + '`。\n\n保留在D盘，没有复制到C盘；D盘离线或目录改名后需更新导航链接。')

# Record every original file (including archives), plus hashes for all 46 independent documents.
before = []
for p in SRC.rglob('*'):
    if p.is_file():
        row = {'path': p.relative_to(SRC).as_posix(), 'bytes': p.stat().st_size}
        if row['path'].startswith('docs_rk1828/'):
            row['sha256'] = hashlib.sha256(p.read_bytes()).hexdigest()
        before.append(row)
(BASE / 'before.json').write_text(json.dumps(before, ensure_ascii=False, indent=2), encoding='utf-8')
(BASE / 'moves.json').write_text(json.dumps(moves, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'original_files': len(before), 'move_operations': len(moves), 'independent_documents': sum('sha256' in x for x in before), 'generated_files': len(list(STAGE.rglob('*.md')))}, ensure_ascii=False))
