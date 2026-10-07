# iPhone App 宿主准备

复用已存在的 `OrderAssistantApp` 工程，为官方 iOS Demo 增加可审阅的 iPhone/iPad App 宿主。只附带工程、Info.plist、shared scheme 和 MIT 许可；SwiftUI 业务源码与 SDK 来自公开 Demo。来源提交、原始/适配文件摘要及具体改动在 `provenance.json`。

1. 从 [官方下载](https://download.tansr.com/demo/ios/ios-demo.zip) 取得 Demo，核对 ZIP SHA256 为 `a33431aa41e4a945931de2c52de24d76e65163fe57a2b1292e844f7efb9056e1`，解到**全新目录**。不要展开内部 XCFramework ZIP，先不要配置或编辑 Demo。官方 URL 没有版本号；摘要变化就停止，不能自动接受新包。
2. 使用 Node 22.19+，从本资产目录运行（替换为用户明确选择的绝对路径）：

   ```sh
   node prepare.mjs --demo /absolute/path/ios-demo --check
   node prepare.mjs --demo /absolute/path/ios-demo
   ```

   Windows 示例：`node prepare.mjs --demo "C:\Users\your-name\Projects\ios-demo"`。脚本逐字节验证 48 个公开文件、正式 SDK 0.3.0 和宿主资产，再新增 `App/`。重复执行拒绝覆盖；损坏、已修改、缺文件或链接目录会停止。它不下载、不安装、不执行随包脚本、不登录、不调用模型。准备成功后再修改业务源或配置。
3. 在 Mac/Xcode 上打开 `App/OrderAssistant.xcodeproj`，选择 `OrderAssistant` scheme。项目消费 `../Sources/OrderAssistant` 以及 `../SDK/tansr-sdk`，只含公开版本的三个二进制产品。保留生成目录结构。

   在生成的 `ios-demo` 根目录，先验证模拟器构建：

   ```sh
   xcodebuild -project App/OrderAssistant.xcodeproj -scheme OrderAssistant \
     -configuration Debug -destination 'generic/platform=iOS Simulator' \
     -derivedDataPath /absolute/new/build-directory CODE_SIGNING_ALLOWED=NO build
   ```

   产物为 `Build/Products/Debug-iphonesimulator/TansrOrderAssistant.app`。选定已启动的模拟器后，用 `xcrun simctl install <UUID> <app绝对路径>` 与 `xcrun simctl launch <UUID> com.tansr.demo.ios` 安装、打开；不要卸载已有用户应用来清状态。

最低 iOS 16、Swift 5 语言模式。2026-10-07 已在 arm64 Mac、Xcode 26.6（17F113）/ Swift 6.3.3 上实际通过公开包 Swift Release 构建、此宿主的无签名 generic iOS Simulator App 构建及 5 项合成 XCTest（0 失败）；8 个验收步骤均退出 0，输入树前后摘要一致。公开示例既有 Swift 6 并发迁移告警保留，合成消费测试不替代私有 SDK 原完整测试池。验收记录见 Skill 根 `compatibility.json` 的 iOS acceptance/evidence；`provenance.json` 中的准备阶段边界保留为历史来源记录。

模拟器 UI、当前 Serve 配对、生命周期/恢复、真机和签名**仍待验**；本次没有启动或安装 App、连接 Serve 或请求模型。真机需要接收方本机的签名身份，模拟器 `.app` 不等于 IPA。

此 App 使用公开分发版开发者登录入口，没有 `DemoServeAuth` 本地直签，也不含私有 SDK 或主线 SDK2 类型。SDK 0.3.0 是 legacy `/v2` 客户端；当前 Serve 0.15.0 必须提供兼容读写入口，并实际验证登录、会话、工具/权限、取消和恢复，不能只凭版本号承诺整链可用。模型请求与媒体功能仍需明确授权及独立验收。旧 UI 测试 target 未随最小宿主交付，不宣称它们已通过。

原宿主使用 MIT 许可，随 `host/LICENSE` 保留；公开 Demo 与三个 SDK 产品的原始许可继续保留在解包目录。
