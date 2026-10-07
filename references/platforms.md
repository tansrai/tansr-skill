# 跨平台接入与交付

核对日期：2026-10-07。已核对公开发行来源，完成 CLI 独立消费、Electron 实际界面与媒体交互，以及 Android、iOS、鸿蒙的构建。Android/iOS 与正式 Serve 的受控 TCP 配对已通过；移动端界面和适用媒体正在补验，尚未完整结算。Node/Web 的实际产品与平台调用以各自回执为准。精确版本与安装合同同时核对项目锁和 `compatibility.json`。

## 从产品需求选宿主

| 用户要的产品 | 采用的运行方式 | 首个交付 |
| --- | --- | --- |
| Node 任务、自动化或命令行业务工具 | Node 服务端使用公开 `@tansr/sdk`；需要 Tansr 交互命令时再选 CLI | 输入到业务输出的可执行程序、受限工具和错误/取消路径 |
| Web 产品或已有网站加 AI | 浏览器承载 UI；Node 后端运行 SDK，或使用 Serve 和公开 API client | 浏览器可操作业务流程、后端登录与授权、真实状态显示 |
| Electron 桌面产品 | 主进程完整 SDK + preload 白名单 IPC + renderer UI | 原生桌面窗口与业务工具；保留权限/提问、恢复与关闭接线 |
| Android / iOS / 原生鸿蒙 | 官方原生客户端 SDK + 自己的 Serve 后端 | 可构建的原生工程、登录/会话/桥接/生命周期与业务界面 |

Node SDK 不打包进浏览器或手机。原生端共享业务合同和后端；各平台 UI、系统授权与媒体适配保持原生。已有工程沿用用户技术栈和锁文件，不因本页出现新版就升级。

## 已发行资源与源码候选分列

| 平台 | 公共发行证据与可取得示例 | 当前差异 |
| --- | --- | --- |
| Node/Web 后端 | [公开 Serve Demo](https://download.tansr.com/demo/android/serve-demo.zip)，随包锁为 Serve `0.15.0` / API client `0.4.0`；[SDK 文档](https://docs.tansr.com/sdk/api/) | `/api` 通过公开 `@tansr/api-client/api`；不要复制旧 `/v2` fetch 示例作为新默认 |
| Electron | [官方组合 ZIP](https://download.tansr.com/demo/electron/electron.zip)，含 `electron-demo.zip` 和 `token-server.zip`；公开包锁 SDK `0.17.0`、Electron `44.1.0` | 本地新 Demo 基线 SDK `0.18.1` 尚未体现在该公开组合包；独立单包/Windows 便携地址本次为 404 |
| Android | Maven Central 的 [core](https://repo1.maven.org/maven2/com/tansr/sdk/core/maven-metadata.xml)、[client](https://repo1.maven.org/maven2/com/tansr/sdk/client/maven-metadata.xml)、[compose](https://repo1.maven.org/maven2/com/tansr/sdk/compose/maven-metadata.xml)、[receiver-android](https://repo1.maven.org/maven2/com/tansr/sdk/receiver-android/maven-metadata.xml) 已有 `0.5.0`；[官方 Demo](https://download.tansr.com/demo/android/android-demo.zip) | Demo 仍锁 `0.4.0` 三模块，附 `0.4.0-demo.3` Debug APK；不能称为 `0.5.0` Demo 或 SDK2 全能力验收 |
| iOS | [公开二进制 SPM `0.3.0`](https://github.com/tansrai/tansr-ios-spm/releases/tag/0.3.0)；[官方 Demo](https://download.tansr.com/demo/ios/ios-demo.zip) | Demo 随包三个 XCFramework 的 SHA256 与该 Release 逐一相同；本地 Swift 主线的 SDK2/UAPI 增量不在这份发行物中 |
| 原生鸿蒙 | [SDK ZIP](https://download.tansr.com/demo/harmony/harmony-sdk.zip) / [Demo ZIP](https://download.tansr.com/demo/harmony/harmony-demo.zip)，随包 `@tansr/harmony` HAR `0.1.0` | 无公共 OHPM 发布；旧公共 HAR 与新本地 HAR 同版本号但字节不同，必须核摘要，不靠 `0.1.0` 名称认能力 |

这里的 ZIP URL 是可取得的官方原件，不是本 Skill 内置模板。下载到用户项目的独立目录后先读 README、依赖锁与来源清单；不覆盖已有项目，也不将完整大型 Demo 复制到 Skill 分发包。执行更新器可能改锁；基线复现先禁用自动更新，后续升级作为一项有验收的变更。

### Node 与 Web

公开 npm 基线为 `@tansr/sdk@0.18.1`、`@tansr/serve@0.15.0`、`@tansr/cli@0.10.2`，运行环境 Node `>=22.19`；实际依赖按 `compatibility.json` 与正式 registry 再核对。CLI 是可选的交互宿主，不是 Web/手机接入的前置安装。

Web 后端若直接嵌入 SDK，UI 调用自己的业务接口，由后端处理用户/租户、工具白名单和会话。需要跨语言/原生消费时使用 Serve，复用公开 ZIP 的 `unified-client`、登录与服务装配，完整合同见 [Serve 与移动端](serve-mobile.md)。浏览器只接自家后端，AppKey、PAT、运维 token 均不下发。

取得 Serve ZIP 后，可在其新目录按随包说明执行 `npm ci`、`npm run configure`，分别启动 `npm run login` 和 `npm start`。`start` 是真实智能体入口，配置后可能调用模型；运行前核对业务授权和费用范围，不把它当零费用 echo。验证阶段设置 `TANSR_DEMO_AUTO_UPDATE=0` 并保留随包锁；不用更新器掩盖兼容问题。

验收应覆盖浏览器操作到后端业务结果、拒绝/取消、错误显示、断流未完成状态、用户隔离和重启恢复；受控离线模型只能证明对应链路，真实模型另留证。

### Electron

从官方组合包取得两个独立工程。token-server 保管 AppKey，桌面主进程以短期 token 使用完整 SDK。复用 `SessionView` 投影、业务工具、权限/提问桥、持久化与关闭接线；renderer 只通过具名 preload 通道请求操作。

保持 `nodeIntegration` 关闭、`contextIsolation` 和 sandbox 开启；不向 renderer 暴露 Node、令牌或原始 `ipcRenderer`。模型内容按文本/受控产物渲染。这个方案不要求自建 Serve，也不把桌面改为移动端式薄客户端。

先按两个工程 README 执行 `npm ci`，固定自动更新后再启动 token-server 和 Electron。公共 ZIP 实际锁 SDK `0.17.0`；要用 `0.18.1` 的公开加法，先升级依赖并通过原测试/构建/GUI 检查，不能声称下载包已经升级。源码可用于三桌面平台；具体打包、签名、公证和安装须在目标系统验证。当前核验没有可公开取得的 Windows 便携包证据。

验收：实际窗口发消息与显示工具结果、拒绝权限、回答问题、IPC 非法请求拒绝、重连/恢复、等待真实关闭；媒体下载失败保留执行状态。本轮在独立公开包消费目录安装了经官方摘要校验的 Electron 44.1.0，原51项测试、类型检查、构建和隐藏进程启动/渲染/关闭通过；修后消费的实际交互结果见下文，真实供应商调用仍独立验收。接收方仍需安装自己平台的运行库，不能依赖作者本机缓存。

已确认的公开 Demo 修正：业务工具以 `tool.completed` 携带 `isError: true` 时，正式 `SessionView` 把原因保存在失败工具项的 `resultText`，不一定提供 `errorMessage`。原 `renderer/renderer.js` 的失败分支只取后者，可能只显示 `error:`。复用该公开版本时，失败卡先取非空字符串 `errorMessage`，再取非空字符串 `resultText`；都没有时仅显示错误类型。仍通过原 `el` 的 `textContent` 展示，不能把原始 `result/error` 对象或 HTML 注入页面。该最小修正在 SDK0.18.1 的真实错误链回归以及独立公开0.17.0消费副本的53项测试、类型和构建中通过；官方ZIP尚未更新，修后副本的实际窗口结果另列。不要将已经修正的本地消费副本写成原下载包已修。

新解压该公开版本后，先关闭 Demo，在 Skill 根目录执行随包的[离线准备工具](../scripts/prepare-demo.mjs)：

```sh
node scripts/prepare-demo.mjs electron "<解压后的 electron-demo 绝对目录>"
```

工具仅接受已核对的原始 renderer，应用同一份已验修正；已经修正时返回 `already-prepared` 且不写文件。遇到其他版本、用户修改或路径链接会拒绝，不覆盖原内容；此时保留项目并审查差异。它不安装依赖、读取 `.env`、升级 SDK 或启动应用。来源、许可和前后摘要在[修正清单](../assets/demo-repairs/electron.json)。准备成功后按原工程执行构建和目标平台验收，不能把 `prepared` 当成产品已经运行或发布。

修后公开消费副本已在 Windows Electron 44.1.0 通过14项真实主进程/preload/renderer交互、3项冷启动恢复、3项虚拟麦克风录音检查和1项独立TTS播放检查。涵盖权限拒绝/允许、取消后继续、图文输入、音频文件及原录音按钮生成的PCM WAV转写为可编辑草稿、朗读及异常、图片解码、视频实际播放、同一会话恢复且不自动重放。TTS原播放器的时间推进、结束事件和无媒体错误另有证据；初始组只验证音频元数据，不代替实际播放。各独立实例的Session、窗口及回环服务均正常关闭。文件选择器只返回指定合成素材，不算操作系统选择器验收；录音使用Chromium虚拟设备，不采集环境声音，也不代表实体麦克风或扬声器音质。真实供应商、其他桌面系统与发行签名仍需各自验证。精确回执见兼容清单的 `consumerRepair.gui`；原公开ZIP尚未更新。

### Android

两种入口分别处理：直接接入新 SDK 时从 `mavenCentral()` 精确选 `com.tansr.sdk:core/client/compose:0.5.0`，需要原生档案接收器才加入同版 `receiver-android:0.5.0`；三核心模块不可混版。SDK 的 `0.5.0` 已切统一错误和 `/api`，需要匹配 Serve 的门面、合同族及能力。

第一阶段的已验起步组合是公开Demo的SDK `0.4.0` 与 Serve `0.15.0` 的 legacy 读写入口。优先从这个可复现组合改造业务；上段 `0.5.0` 只登记已发行的另一条迁移入口，其配对仍待验，不能未验证就替换默认版本，或把旧版Demo结果套给它。

复用旧公开 Demo 时先保留 `sample/sdk.lock.json` 的 `0.4.0` 三模块与随包 APK。按 README 使用 `node scripts/run-sample.mjs --frozen` 验证原锁；不加 `--frozen` 的更新器会寻找共同最新稳定版，可能选到 `0.5.0`，这属于迁移。源码主线出现 SDK2 面板不说明公开旧 APK 包含它。

全新解压该公开版本后，先通过同一离线准备入口应用固定 Demo 修正，再执行原构建：

```sh
node scripts/prepare-demo.mjs android "<解压后的 android-demo 绝对目录>"
```

修正涉及两个既有界面文件及一个新增历史图片适配文件：为顶栏及底部操作区留出系统安全区、匹配浅色背景的系统栏图标，并让窗口随键盘缩放，避免整页上移遮住顶栏；播放器已暂停时显示暂停文案，保留原后台暂停与停止/缓存重播行为；通过公开历史接口补齐冷恢复图片。SDK、锁、版本和业务工具不变。

公开SDK0.4.0会保留历史图片数据，但默认历史界面投影跳过图片块。Demo适配器按原消息身份、角色、内容顺序和已消费序号匹配历史，保留实时消息、工具与用量状态；切换会话或连接后不会接收旧请求结果。不通过重新发送用户消息来恢复图片。预览有独立的图片大小、总量和解码预算，不能当作平台上传上限；原用户图片组件只显示缩略图，不因此承诺可点击全屏查看。

准备器先核验整组输入及修后摘要，再逐文件发布；新增文件不覆盖已有目标，已精确修正时不写文件。已有用户修改、其他版本和链接目标会被拒绝，不能强制覆盖。这不是三个文件的整体事务：I/O中断时可能已有部分文件完成，须按错误中列出的路径保留现场、核对后续处理；不自行删除目录或覆盖未知内容。来源、许可、原/后摘要见[Android修正清单](../assets/demo-repairs/android.json)。原公开ZIP及随包APK未更新，需要从修后源码重新构建；准备成功本身不等于设备验收或已发布。

宿主接 Kotlin/Compose UI、逐请求 authProvider、生命周期、业务工具和权限/提问桥；恢复原会话，不因切屏重建。公开文档为 [Android 接入](https://docs.tansr.com/android/)。最低 API 26，实际 Gradle/JDK/compileSdk 以下载工程为准；本地仓当前 compileSdk 37，不能用“Android SDK 已安装”替代构建验证。

验收：公开 Maven 精确解析、原构建与依赖来源门、安装 APK、登录/流式会话、权限拒绝、旋转/后台与断网恢复；若使用 receiver 再执行实际仪器测试、持久化后 ACK、加密/钥缺失拒绝及重开恢复。本轮公开 Demo 原 `0.4.0` 锁的来源门、Debug APK 构建、106项单元测试及23项更新器测试已通过，使用任务独立调试密钥并核验签名。后续独立API36模拟器实际完成8组原生旅程及系统照片、麦克风拒绝、静音录音转草稿三组系统操作；模型/媒体响应为合成数据。历史图片修正另通过18项针对性测试和两次独立进程冷启动，自动恢复原图与旧文字，正式服务确认原会话及图片摘要不变、没有新消息或模型请求。按原红及受影响复验分轮结算，不称所有步骤在同一个最终APK重新执行；原任务模拟器正常关闭、数据保留。真机、真实环境声音、供应商质量及SDK0.5.0迁移仍是不同验收边界。

另在真实本机 TCP 上完成正式 Android SDK `0.4.0` 与 Serve `0.15.0` 的 legacy `/v2` 配对：1项连续 JVM 测试、8个检查点，验证建会/SSE、端侧业务工具结果、两用户隔离、权限拒绝不执行、真实任务取消、游标重连、服务重启后历史和归属保持、资源正常关闭。模型及身份为合成输入，未调用平台。此结果不替代设备前后台、界面和媒体，也不扩展到 `0.5.0` 的 `/api` 或其他原生 SDK。

### iOS

新 App 可用公开包 `.package(url: "https://github.com/tansrai/tansr-ios-spm.git", exact: "0.3.0")`，产品为 `TansrCore`、`TansrClient`、`TansrUI`。公开 Demo 默认通过本地 SPM 依赖消费随包三个 XCFramework，先沿该形态复现，不与源码 SDK 混进同一个依赖图。

最低 iOS 16 / macOS 13；Swift tools 5.9，实际 Xcode 必须满足随包二进制接口的工具链要求，原发行验证使用 Xcode 26.6 / Swift 6.3.3、Swift 5 语言模式。官方 Demo 带原 SwiftUI 业务界面但没有 `.xcodeproj`；本 Skill 的 [iPhone App 宿主资产](../assets/ios-app-host/README.md) 复用正式 0.3.0 对应源码提交的已有 App 工程，继续消费公开 Demo 和随包正式 SDK，不复制私有 SDK 或当前主线 SDK2 源码。见 [iOS 接入](https://docs.tansr.com/ios/)。

取得官方 ZIP，核 SHA256 `a33431aa41e4a945931de2c52de24d76e65163fe57a2b1292e844f7efb9056e1` 后解到全新目录，先不要编辑配置或展开内部 XCFramework ZIP。在 Skill 根运行 `node assets/ios-app-host/prepare.mjs --demo <ios-demo绝对路径> --check`，再去掉 `--check` 准备。脚本核对 48 个公开文件、SDK0.3.0 及宿主摘要，新增 `App/` 并应用[固定修正清单](../assets/ios-app-host/demo-repairs.json)中的 Demo 改动，生成回执记录源文件前后摘要；SDK与锁文件不变。已有输出、坏摘要、缺文件或链接目录均停止，不覆盖用户工程。公开 URL 更新导致摘要变化时重新核来源，不自动接受。

准备完成后在 Mac 打开 `App/OrderAssistant.xcodeproj`，选择共享 `OrderAssistant` scheme；具体 `xcodebuild`、安装路径和来源/许可见资产说明。此宿主的文件准备、26 个 Swift 源引用闭包和重复执行拒绝已在 Windows 隔离副本检查。2026-10-07 又在 arm64 Mac、Xcode 26.6（17F113）/ Swift 6.3.3、Swift 5 语言模式下，实际通过公开 Demo 的 Swift Release 构建、无签名 generic iOS Simulator App 构建及 5 项合成 XCTest（0 失败）；8 个验收步骤均退出 0，输入树前后摘要一致。已有 iOS 产品只复用所需接线，不向其目录强行运行准备脚本，也不能把 SwiftPM executable 或模拟器 `.app` 当可安装 IPA。

逐请求登录、SwiftUI 生命周期、权限/提问桥、系统录音播放和后台恢复复用原 Demo。公开 `0.3.0` 属 legacy `/v2` 消费，不包含本地新主线的 SDK2 档案/统一错误 API。正式SDK0.3.0与Serve0.15.0的真实TCP配对已通过3项XCTest、13个检查点，覆盖订单工具成功回执、拒绝零写入、用户隔离、取消、重连与新对象恢复、图片字节往返、合成TTS/ASR及明确能力/上游错误；宿主排空、结算和存储刷新后资源归零。该证据要求服务提供legacy读写入口，不能套用于关闭或只读legacy的服务配置。之后使用随包更新脚本前保全原SDK，并为选定版本验证发布SHA、实际编译和交互。

独立iOS模拟器已完成原8个test-ID的断言范围，按原红和受影响补验逐项结算，没有把多轮重叠测试相加。已验原系统照片选择、图文输入、订单查询/退款拒绝、取消、前后台、同会话冷恢复、TTS分段暂停/继续/缓存重播、图片产物、能力关闭及失败说明；另验原AVPlayer播放视频、重播和后台关闭。模型与素材均为合成输入，未调用付费平台。

验收发现并修正三处公开Demo问题：暂停时当前段仍显示播放中；媒体页冷恢复缺少自己的刷新任务；嵌套滚动区仅设最大高度会导致历史图片展开时SwiftUI布局循环。修后已实际验证自动加载图片、完整预览、关闭和重开。准备工具通过固定清单交付同一修正，保留SDK、协议、锁和原ZIP；已修改的用户工程只审查差异，不能强制套用。原始失败与最终证据见兼容清单的iOS `nativeAcceptance`。

录音正向仍未验：拒绝麦克风分支已通过，但不代替真实录音器采集后将ASR结果填入可编辑草稿。当前Mac没有可用虚拟输入，受限短录音等待明确授权；未采集环境声。本轮唯一模拟器已停止，原14台设备状态不变，本轮SSH隧道已关闭。真机、签名/上架和真实供应商质量另行验收；公开示例既有Swift6并发告警保留，公开消费测试不替代新主线私有SDK整库门。

### 原生鸿蒙

使用官方 SDK/Demo ZIP 的版本化字节码 HAR；不是 Android APK 兼容路线，也不是公共 OHPM 包。公开 `0.1.0` HAR 为 73,946 字节、SHA256 `dab5df5926d391e34f597a1323479564e3a96cd8c313782ce6fce19def750387`。SDK ZIP 与 Demo ZIP 内该 HAR 逐字节相同。当前本地同名 `0.1.0` HAR 为另一摘要，不能替换后仍声称同一公开发行。

Demo 的 `entry` 消费随包 `libs`，安装和构建先核 `sdk-artifact.json`、HAR 和 OHPM 解析结果。缺失/摘要不符即停止，不回落源码仓。按包内脚本使用 DevEco，保持 Stage/ArkTS/ArkUI；最低 HarmonyOS 6 / API 20、目标 API 22。见 [鸿蒙接入](https://docs.tansr.com/harmony/)。

全新解压已核公开Demo并关闭应用后，在Skill根目录应用固定生命周期修正：

```sh
node scripts/prepare-demo.mjs harmony "<解压后的 harmony-demo 绝对目录>"
```

仅修改`DemoController.ets`的后台处理：保留原界面的暂停，取消随后覆盖它的停止播放调用；显式加载其他媒体、关闭预览和音频切换仍保留停止逻辑。准备器只接受精确原件或已修字节，已修时不写文件，未知版本、用户修改及链接路径均拒绝。来源和前后摘要见[鸿蒙修正清单](../assets/demo-repairs/harmony.json)，沿用公开包已有约定，不新增开源许可。55个公开文件中其余54个保持不变，包括HAR、锁及配置；原公开ZIP未更新，须从准备后的源码构建HAP。

共享 Serve 后端与开发者登录，复用 HAR 的会话、SSE、权限/问题/业务工具桥；平台网络、录音、播放器、相册和生命周期适配留在 App。该公共 HAR 属旧 legacy 消费，未包含新本地 SDK2/UAPI 接线。

验收：独立 ZIP 原生 HAR 消费、ArkTS/HAP 构建、模拟器真实交互、前后台与断流恢复、权限拒绝和媒体资源释放。本轮固定公开 HAR 的依赖安装、HAP、测试 HAP 和 lint 已通过；使用同版 DevEco 6.0.2.670 / Hvigor 6.22.9，原始候选未修改业务源码，后续视频修正单独结算。已将独立App和测试HAP安装到API22模拟器：实际Hypium集合为22例（13登录、8个HAR用例、1个UI用例），首轮21通过、1个UI错误；普通解锁后同一UI用例通过，全部22个独立用例已覆盖，原错误保留，不重复计数。

原App另完成64个核心步骤，由已通过的13步订单查询与同会话后续51步组成，中间失败不重计。实际审批允许/拒绝、工具结果、退款拒绝后状态不变、取消、前后台与重新登录恢复均与正式Serve回执逐项匹配；恢复没有重发消息或模型请求。

媒体已验系统PhotoViewPicker选择指定合成图片、图文发送和历史图片展示、图片产物、原TTS播放器时间推进/暂停/停止，以及输入限制、能力关闭和失败无产物。选图时原PNG与App转换后的JPEG分别核对，没有把不同编码字节强求相等。模型及转写为受控响应，不代表真实供应商质量。

视频实测发现公开Demo的后台流程先暂停又停止原生播放器，回前台后位置归零、一直显示“Preparing video”。上面的固定修正已通过HAP构建、lint及原第18–24步受影响复验：同一已有视频实际播放、暂停在3秒，后台返回后仍停在3秒，显式关闭后播放器组件移除。原24步按通过前缀与修后后缀去重结算，中间失败保留；没有重新VideoGen或改动HAR，不能说原下载包已修。正向录音尚待环境麦克风授权；真机签名/安装、最低API镜像和应用商店分别验收。

## 交付时逐层说明结果

每个平台记录：依赖来源/精确版本/摘要、服务版本和合同入口、构建命令与退出码、安装物、实际设备/OS、完成的 UI 操作、权限/取消/恢复结果及缺口。源码阅读、包下载、构建、模拟器、真机、真实模型与正式发布是独立事实。

各平台已有资料、构建及实际运行证据按上文分别结算；跨平台关键交互A1-06已经核证，S1-05、A1-07及相关父卡仍按完整适用范围结算。缺少工具链、设备、凭据或费用授权时继续完成不依赖它们的代码与受控验证，并写出恢复验收的具体入口，不虚构成功。
