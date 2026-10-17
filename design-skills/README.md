# AI CPE 网页视觉与交互技能

这些技能安装在当前项目中，后续设计任务按此索引读取对应的 `SKILL.md`。此普通项目目录不依赖 `.agents/skills` 自动发现，也没有修改全局技能目录。

## 技能索引

| 技能 | 用途 | 来源 |
| --- | --- | --- |
| [frontend-design](frontend-design/SKILL.md) | 产品视觉方向、排版、配色、空间层次和设计自评 | Anthropic |
| [gsap-core](gsap-core/SKILL.md) | 界面动效、缓动、SVG 动画、响应式及减少动态效果 | GSAP 官方 |
| [gsap-timeline](gsap-timeline/SKILL.md) | 多元素编排、状态过渡、可中断与可逆的动画序列 | GSAP 官方 |
| [gsap-performance](gsap-performance/SKILL.md) | 动效流畅度、避免布局抖动、资源清理 | GSAP 官方 |
| [threejs-scene](threejs-scene/SKILL.md) | 三维场景、镜头、构图、渲染生命周期 | cesartevisual 社区技能集 |
| [threejs-lighting](threejs-lighting/SKILL.md) | 环境光、主光、阴影和空间质感 | cesartevisual 社区技能集 |
| [threejs-particles](threejs-particles/SKILL.md) | 粒子场、点云、实例化及 GPU 模拟 | cesartevisual 社区技能集 |
| [threejs-shaders](threejs-shaders/SKILL.md) | GLSL 着色器、程序化材质、形变和流动效果 | cesartevisual 社区技能集 |
| [threejs-postprocessing](threejs-postprocessing/SKILL.md) | 辉光、抗锯齿、景深和渲染合成 | cesartevisual 社区技能集 |
| [threejs-performance](threejs-performance/SKILL.md) | 帧耗时、GPU 负载、内存、质量分级和降级 | cesartevisual 社区技能集 |

上游地址：[Anthropic Skills](https://github.com/anthropics/skills)、[GSAP Skills](https://github.com/greensock/gsap-skills)、[Three.js 社区技能集](https://github.com/cesartevisual/threejs-skills)。各文件夹保留许可证；固定提交版本和文件 SHA256 见 [sources.json](sources.json)。Three.js 技能集为社区项目，不是 Three.js 官方发布。

## 当前项目的设计目标

以消费级智能硬件的产品界面为目标，建立有辨识度的空间、材质、光影与运动语言，超越普通桌面管理表单的表现方式。粒子、场景和动效需要服务于真实网络状态及用户操作，让人能清楚理解当前设备情况、AI 是否听到、正在处理什么，以及操作产生了什么结果。

- 主界面聚焦关键网络状态，语音、遥控和触屏是主要入口；聊天记录和键盘输入作为辅助。
- 先明确视觉方向与交互状态，再决定场景和动画。避免把大量炫技、数据或选项同时推给用户。
- 可探索信号流、连接拓扑、呼吸光、粒子聚散、空间展开和材质变化；它们是候选设计语言，需结合后续用户指导选择。
- 选定统一的动画时长、缓动、色彩与层次规则，使待机、唤醒、聆听、思考、答复、确认、执行和失败具有可辨识且一致的反馈。
- 关键操作响应优先；装饰动画不阻塞操作。网络质量反馈必须来自真实、可解释的数据，不能由粒子多少或颜色变化制造未经验证的好坏结论。
- 以目标设备实测评估流畅度和资源占用，限制像素比、粒子数量与后期效果成本，支持减少动态效果和静态替代。尚未在目标硬件测量前不宣称达到某个帧率。

## 后续使用顺序

1. 视觉和信息架构：读取 `frontend-design/SKILL.md`，结合当前用户的产品分析确定方向。
2. 交互与状态动画：读取 `gsap-core`、`gsap-timeline`，按需结合 `gsap-performance`。
3. 粒子或渲染场景：从 `threejs-scene` 开始，按实际效果选择 lighting、particles、shaders、postprocessing。
4. 实现和验收：读取性能技能，在浏览器检查响应式、交互中断、重复进出、资源释放及动态效果降级。

这些文件提供设计与实现工作方法；网页运行时的 GSAP、Three.js 等依赖在具体实施时再按方案引入。
