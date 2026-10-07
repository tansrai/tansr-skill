# iPhone App 宿主准备

复用已存在的 `OrderAssistantApp` 工程，为官方 iOS Demo 增加可审阅的 iPhone/iPad App 宿主。只附带工程、Info.plist、shared scheme 和 MIT 许可；SwiftUI 业务源码与 SDK 来自公开 Demo。来源提交、原始/适配文件摘要及具体改动在 `provenance.json`。

1. 从 [官方下载](https://download.tansr.com/demo/ios/ios-demo.zip) 取得 Demo，核对 ZIP SHA256 为 `a33431aa41e4a945931de2c52de24d76e65163fe57a2b1292e844f7efb9056e1`，解到**全新目录**。不要展开内部 XCFramework ZIP，先不要配置或编辑 Demo。官方 URL 没有版本号；摘要变化就停止，不能自动接受新包。
2. 使用 Node 22.19+，从本资产目录运行（替换为用户明确选择的绝对路径）：

   ```sh
   node prepare.mjs --demo /absolute/path/ios-demo --check
   node prepare.mjs --demo /absolute/path/ios-demo
   ```

   Windows 示例：`node prepare.mjs --demo "C:\Users\your-name\Projects\ios-demo"`。脚本逐字节验证 48 个公开文件、正式 SDK 0.3.0 和宿主资产，预先核对三份 Swift 修正的精确产物摘要，再新增 `App/` 并应用修正。`--check` 只校验不写入；完整生成后的 `App/PREPARATION.json` 记录三份源文件前后摘要，其余 45 份公开文件不变。重复执行拒绝覆盖；损坏、已修改、缺文件或链接目录会停止。它不下载、不安装、不执行随包脚本、不登录、不调用模型。准备成功后再修改业务源或配置。

   `demo-repairs.json` 固定三份文件的原/后摘要与有序精确替换，包含各文件的 CRLF→LF 归一化。`ContinuousSpeechRun.swift` 与 `SpeechSegmentsPanel.swift` 修正当前语音段暂停时的显示，保留播放和缓存状态。`ChatScreen.swift` 让上下文/媒体详情页拥有自己的刷新任务，父视图在详情展示期间不竞争刷新，并固定内层历史图片预览高度为 240，避免展开时的 SwiftUI 布局循环；原取消、代际守卫和预览数量上限保留。原 ZIP、SDK、锁文件与许可不修改。如果生成中途发生 I/O 错误，保留半成品检查，不能对该目录强制重跑；原目录和用户文件保护继续生效。
3. 在 Mac/Xcode 上打开 `App/OrderAssistant.xcodeproj`，选择 `OrderAssistant` scheme。项目消费 `../Sources/OrderAssistant` 以及 `../SDK/tansr-sdk`，只含公开版本的三个二进制产品。保留生成目录结构。

   在生成的 `ios-demo` 根目录，先验证模拟器构建：

   ```sh
   xcodebuild -project App/OrderAssistant.xcodeproj -scheme OrderAssistant \
     -configuration Debug -destination 'generic/platform=iOS Simulator' \
     -derivedDataPath /absolute/new/build-directory CODE_SIGNING_ALLOWED=NO build
   ```

   产物为 `Build/Products/Debug-iphonesimulator/TansrOrderAssistant.app`。选定已启动的模拟器后，用 `xcrun simctl install <UUID> <app绝对路径>` 与 `xcrun simctl launch <UUID> com.tansr.demo.ios` 安装、打开；不要卸载已有用户应用来清状态。

最低 iOS 16、Swift 5 语言模式。2026-10-07 的初始宿主在 arm64 Mac、Xcode 26.6（17F113）/ Swift 6.3.3 上实际通过公开包 Swift Release 构建、无签名 generic iOS Simulator App 构建及 5 项合成 XCTest（0 失败）；8 个验收步骤均退出 0，输入树前后摘要一致。随后，上述精确语音显示修正通过真实 Swift 行为回归及暂停/恢复/缓存 UI 用例；最终三文件候选通过无签名编译和冷恢复图片自动加载→展开→关闭→重开再展开的原生 UI 回归。Skill 根 `compatibility.json` 的 iOS `acceptance` 保留初始构建事实，当前界面结果见 `nativeAcceptance`，最终准备器复现见 `hostPreparationEvidence` 及 `hostPreparationDeliveryEvidence`；不将这些局部回归合计为完整测试池。公开示例既有 Swift 6 并发迁移告警保留。

准备工具本身不启动或安装 App、不连接 Serve、不请求模型；生成成功不代表这些流程已验收。已验证的模拟器行为与合成服务边界由上述验收记录逐项列明；真机与签名仍待验。真机需要接收方本机的签名身份，模拟器 `.app` 不等于 IPA。

此 App 使用公开分发版开发者登录入口，没有 `DemoServeAuth` 本地直签，也不含私有 SDK 或主线 SDK2 类型。SDK 0.3.0 是 legacy `/v2` 客户端；当前 Serve 0.15.0 必须提供兼容读写入口，并实际验证登录、会话、工具/权限、取消和恢复，不能只凭版本号承诺整链可用。模型请求与媒体功能仍需明确授权及独立验收。旧 UI 测试 target 未随最小宿主交付，不宣称它们已通过。

原宿主使用 MIT 许可，随 `host/LICENSE` 保留；公开 Demo 与三个 SDK 产品的原始许可继续保留在解包目录。
