# 在自己的助手中准备 Tansr Skill

适用于“让 Codex 或 WorkBuddy 借助 Tansr 构建产品”。Skill 为助手提供工作步骤与资料；应用实际运行依赖 SDK / Serve，见[产品使用](use.md)。两者分别准备。

截至 2026-10-07，Tansr Skill 安装器尚未实现并发行，本指引没有可承诺的一键 npx 命令。当前源码和应用模板仍在实施，手动放入文件不表示目标助手已经适配或模板已经验收。先记录所用 Skill 来源、版本或文件指纹，再核实目标助手的实际发现与调用。

## Codex：在一个项目内手动准备

官方文档确认：Codex 从当前工作目录向仓库根逐级查找 `.agents/skills`，用户级位置为 `$HOME/.agents/skills`。通常先在目标项目内准备，范围容易检查；用户明确选择跨项目使用时，再考虑用户级目录，不同时向所有位置复制。

1. 打开用户要开发的项目，确认项目根目录。检查 `.agents/skills/tansr` 是否已经存在；存在时先确认来源和用户修改，保留原内容，不直接覆盖、不删除整个技能目录。
2. 取得用户已确认来源、经过审阅的完整 Skill 内容。在项目中创建 `.agents/skills/tansr/`，将入口放为 `.agents/skills/tansr/SKILL.md`，并保留入口引用的参考、资产、脚本、许可证与 NOTICE 的相对位置。不能只复制入口而遗漏资源，也不要把开发仓的 `.git`、日志或真实凭据一起复制。
3. 核对 `SKILL.md` 开头是 YAML 元数据，至少有 `name: tansr` 和准确的 `description`，后面是 Markdown 指令。`agents/openai.yaml` 是可选元数据。此检查只说明文件结构已准备好。
4. 回到该项目的 Codex。CLI / IDE 可以用 `/skills` 或输入 `$` 选择技能；也可明确要求使用 Tansr Skill。桌面端以当前可见的技能入口为准。Codex 官方说明会自动检测技能变化；新内容没有出现时，保存当前工作后由用户重启 Codex，再检查。
5. 用一个相关的小任务验证，例如：“使用 Tansr Skill，阅读当前项目并说明接入位置；先不发起 Tansr 模型调用、不部署。”记录助手实际读取的 `SKILL.md` 路径及回答是否符合该任务。需要验证自动触发时，再给同类自然语言任务，观察是否实际读取。显式调用通过不能自动记为自动触发也通过。

示意结构如下；资源以当前入口的真实引用为准：

```text
目标项目/
└── .agents/
    └── skills/
        └── tansr/
            ├── SKILL.md
            ├── references/
            ├── assets/
            ├── agents/          # 可选
            ├── LICENSE
            └── NOTICE
```

同名 Skill 不会自动合并，可能同时出现在选择器。以实际读取路径区分，不能因用户目录已有 `.codex/skills` 就把它当作本轮已确认的安装约定。无需为手动准备修改全局助手配置、开放所有工具或加入供应商凭据。

来源：实际打开的 [OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills)；原 [Codex Skills](https://developers.openai.com/codex/skills/) 链接已重定向。Windows 的 Codex CLI 0.158.0-alpha.2.1 已在隔离项目完成自然触发、显式 `$tansr` 和无关负触发：前两项实际读取入口及按需参考，后一项零工具，项目文件均未改变。此为手动放置内容后的只读宿主验证，不代表 npx 安装、完整包装配、GUI 选择器、WorkBuddy 或 macOS/Linux 已验收。

## WorkBuddy：先走官方技能导入入口

官方专属文档确认技能面板支持本地技能包导入，导入后自动配置，并可启用、关闭、卸载；对话框可以选择已安装技能，自定义技能可由自然语言触发。本轮尚未确认项目级/用户级扫描目录、完整包结构与 `SKILL.md` 必填格式，也未确认外部文件修改的热重载方式。

1. 在用户已安装的 WorkBuddy 中打开技能面板，查看当前版本实际提供的本地导入入口和文件格式说明；先记录宿主版本。没有安装环境时保留待验，不声称已完成适配。
2. 只有取得与该版本导入要求一致、已审阅的完整技能包后才导入。当前 Tansr 源码目录不能直接宣称为 WorkBuddy 合格导入包；格式仍不明确时，记录界面提示及缺失条件，继续可独立完成的产品开发工作。
3. 导入后检查技能是否可见、是否启用，在对话框选择它，再用不发起 Tansr 模型调用或部署的小任务验证实际读取。最后单独验证自然语言触发。逐项保留结果，不把“导入成功”扩写成“已实际调用”。

不要向猜测的 `.workbuddy/skills` 或 `.codebuddy/skills` 自动写文件，不通过改名为 `skill.yml` 碰运气。WorkBuddy 英文创建案例提到典型 `skill.yml`，中文专属页没有完整文件规范；同站 CodeBuddy CLI / IDE 的目录和命令也不能直接套给 WorkBuddy。遇到变更不生效时，依当前界面说明处理；没有重载证据就标待核，不编造命令。

系统范围也要按具体版本记录：官方 Mac 指南列 macOS 12+、Intel X64 / M 系列 ARM64；Windows ARM64 资料有冲突信号，Linux 只有更新日志线索。本轮没有可宣称的 Tansr/WorkBuddy 系统适配成功组合。

来源：[技能导入与管理](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market) · [对话框选择](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar) · [中文自定义技能](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Create-Skills) · [英文创建案例](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Create-Skills) · [Mac 安装](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Installation-Mac-Guide) · [FAQ](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/FAQ) · [更新日志](https://www.workbuddy.ai/docs/zh/workbuddy/Changelog)。已核实内容与未知项分列，不从相邻产品推断兼容。

## 准备完成后告诉用户什么

只报告实际得到的状态：文件已经放好、宿主已经发现、显式调用已通过、自动触发已通过，各项分别填写。尚未验证的项标为待验，并给具体下一步。Skill 调用不证明生成应用已运行，更不证明真实平台调用或部署成功。

确认可以使用后，让用户直接描述“想让谁完成什么任务、在哪个设备上用、已经有什么项目或数据”。沿[应用开发](build.md)继续，不要求用户先选一组内部技能。失败时按[排错](troubleshoot.md)处理；本地文件和用户已有配置始终保留。
