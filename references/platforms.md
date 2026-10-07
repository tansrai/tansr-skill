# 跨平台接入与交付

核对日期：2026-10-07。已核对公开发行来源，并完成 CLI 独立消费、Electron 构建与隐藏生命周期、Android Debug APK、iOS 无签名模拟器 App、鸿蒙 HAP 的分层验证。Node/Web 的实际产品与平台调用以各自回执为准。**原生界面、移动端与当前 Serve 的配对及适用媒体仍需按下面的验收条件验证。** 精确版本与安装合同同时核对项目锁和 `compatibility.json`。

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

验收：实际窗口发消息与显示工具结果、拒绝权限、回答问题、IPC 非法请求拒绝、重连/恢复、等待真实关闭；媒体下载失败保留执行状态。本轮在独立公开包消费目录安装了经官方摘要校验的 Electron 44.1.0，51项测试、类型检查、构建和隐藏进程启动/渲染/关闭已通过；实际窗口交互与真实平台仍待验。接收方仍需安装自己平台的运行库，不能依赖作者本机缓存。

### Android

两种入口分别处理：直接接入新 SDK 时从 `mavenCentral()` 精确选 `com.tansr.sdk:core/client/compose:0.5.0`，需要原生档案接收器才加入同版 `receiver-android:0.5.0`；三核心模块不可混版。SDK 的 `0.5.0` 已切统一错误和 `/api`，需要匹配 Serve 的门面、合同族及能力。

复用旧公开 Demo 时先保留 `sample/sdk.lock.json` 的 `0.4.0` 三模块与随包 APK。按 README 使用 `node scripts/run-sample.mjs --frozen` 验证原锁；不加 `--frozen` 的更新器会寻找共同最新稳定版，可能选到 `0.5.0`，这属于迁移。源码主线出现 SDK2 面板不说明公开旧 APK 包含它。

宿主接 Kotlin/Compose UI、逐请求 authProvider、生命周期、业务工具和权限/提问桥；恢复原会话，不因切屏重建。公开文档为 [Android 接入](https://docs.tansr.com/android/)。最低 API 26，实际 Gradle/JDK/compileSdk 以下载工程为准；本地仓当前 compileSdk 37，不能用“Android SDK 已安装”替代构建验证。

验收：公开 Maven 精确解析、原构建与依赖来源门、安装 APK、登录/流式会话、权限拒绝、旋转/后台与断网恢复；若使用 receiver 再执行实际仪器测试、持久化后 ACK、加密/钥缺失拒绝及重开恢复。本轮公开 Demo 原 `0.4.0` 锁的来源门、Debug APK 构建、106项单元测试及23项更新器测试已通过，使用任务独立调试密钥并核验签名；未进行设备安装或UI交互。`0.5.0` + 当前 Serve 的整链兼容仍未运行。

### iOS

新 App 可用公开包 `.package(url: "https://github.com/tansrai/tansr-ios-spm.git", exact: "0.3.0")`，产品为 `TansrCore`、`TansrClient`、`TansrUI`。公开 Demo 默认通过本地 SPM 依赖消费随包三个 XCFramework，先沿该形态复现，不与源码 SDK 混进同一个依赖图。

最低 iOS 16 / macOS 13；Swift tools 5.9，实际 Xcode 必须满足随包二进制接口的工具链要求，原发行验证使用 Xcode 26.6 / Swift 6.3.3、Swift 5 语言模式。官方 Demo 带原 SwiftUI 业务界面但没有 `.xcodeproj`；本 Skill 的 [iPhone App 宿主资产](../assets/ios-app-host/README.md) 复用正式 0.3.0 对应源码提交的已有 App 工程，继续消费公开 Demo 和随包正式 SDK，不复制私有 SDK 或当前主线 SDK2 源码。见 [iOS 接入](https://docs.tansr.com/ios/)。

取得官方 ZIP，核 SHA256 `a33431aa41e4a945931de2c52de24d76e65163fe57a2b1292e844f7efb9056e1` 后解到全新目录，先不要编辑配置或展开内部 XCFramework ZIP。在 Skill 根运行 `node assets/ios-app-host/prepare.mjs --demo <ios-demo绝对路径> --check`，再去掉 `--check` 准备。脚本核对 48 个公开文件、SDK0.3.0 及宿主摘要，只新增 `App/`；已有输出、坏摘要、缺文件或链接目录均停止，不覆盖用户工程。公开 URL 更新导致摘要变化时重新核来源，不自动接受。

准备完成后在 Mac 打开 `App/OrderAssistant.xcodeproj`，选择共享 `OrderAssistant` scheme；具体 `xcodebuild`、安装路径和来源/许可见资产说明。此宿主的文件准备、26 个 Swift 源引用闭包和重复执行拒绝已在 Windows 隔离副本检查。2026-10-07 又在 arm64 Mac、Xcode 26.6（17F113）/ Swift 6.3.3、Swift 5 语言模式下，实际通过公开 Demo 的 Swift Release 构建、无签名 generic iOS Simulator App 构建及 5 项合成 XCTest（0 失败）；8 个验收步骤均退出 0，输入树前后摘要一致。已有 iOS 产品只复用所需接线，不向其目录强行运行准备脚本，也不能把 SwiftPM executable 或模拟器 `.app` 当可安装 IPA。

逐请求登录、SwiftUI 生命周期、权限/提问桥、系统录音播放和后台恢复复用原 Demo。公开 `0.3.0` 属 legacy `/v2` 消费，不能假定有本地新主线的 SDK2 档案/统一错误 API。与当前 Serve 0.15.0 的精确配对还需实际联验；服务主动关闭或只读 legacy 时，不能宣称可直接使用。准备器先复现固定原件，之后使用随包更新脚本前备份原 SDK，并为选定版本验证发布 SHA、实际编译和交互。

剩余验收：模拟器真实 UI、当前 Serve 精确配对、权限/取消/生命周期与恢复；承诺 iPhone 安装时再验签名/真机。本次没有启动或安装 App、连接 Serve 或调用模型。公开示例既有 Swift 6 并发迁移告警保留；5 项合成消费测试不替代私有 SDK 的原完整测试池。构建与回执见 `compatibility.json` 的 iOS acceptance/evidence；本次通过不代表新源码候选或 A1-06 整个平台断言已完整通过。

### 原生鸿蒙

使用官方 SDK/Demo ZIP 的版本化字节码 HAR；不是 Android APK 兼容路线，也不是公共 OHPM 包。公开 `0.1.0` HAR 为 73,946 字节、SHA256 `dab5df5926d391e34f597a1323479564e3a96cd8c313782ce6fce19def750387`。SDK ZIP 与 Demo ZIP 内该 HAR 逐字节相同。当前本地同名 `0.1.0` HAR 为另一摘要，不能替换后仍声称同一公开发行。

Demo 的 `entry` 消费随包 `libs`，安装和构建先核 `sdk-artifact.json`、HAR 和 OHPM 解析结果。缺失/摘要不符即停止，不回落源码仓。按包内脚本使用 DevEco，保持 Stage/ArkTS/ArkUI；最低 HarmonyOS 6 / API 20、目标 API 22。见 [鸿蒙接入](https://docs.tansr.com/harmony/)。

共享 Serve 后端与开发者登录，复用 HAR 的会话、SSE、权限/问题/业务工具桥；平台网络、录音、播放器、相册和生命周期适配留在 App。该公共 HAR 属旧 legacy 消费，未包含新本地 SDK2/UAPI 接线。

验收：独立 ZIP 原生 HAR 消费、ArkTS/HAP 构建、模拟器真实交互、前后台与断流恢复、权限拒绝和媒体资源释放。本轮固定公开 HAR 的依赖安装、HAP、测试 HAP 和 lint 已通过；使用同版 DevEco 6.0.2.670 / Hvigor 6.22.9，未修改业务源码。9个 Hypium 用例只完成编译，`hdc` 未发现设备，尚未执行或验证原生交互。产物未签名；真机签名/安装、最低 API 镜像和应用商店分别验收。

## 交付时逐层说明结果

每个平台记录：依赖来源/精确版本/摘要、服务版本和合同入口、构建命令与退出码、安装物、实际设备/OS、完成的 UI 操作、权限/取消/恢复结果及缺口。源码阅读、包下载、构建、模拟器、真机、真实模型与正式发布是独立事实。

本次资料核验可以支持选择已发行入口及编写接线文档；不关闭 S1-05 或 A1-06 的平台运行断言。缺少工具链、设备、凭据或费用授权时继续完成不依赖它们的代码与受控验证，并写出恢复验收的具体入口，不虚构成功。
