# .NET、Go、Rust、Python、C++

核对日期：2026-10-09。下面只写已在公开渠道出现的版本。已有工程保持原语言、构建系统和锁文件；不要为了示例把 C# 服务改成 Node，也不要把这些包装进浏览器或手机。

Serve 仍是单独部署的服务。客户端拿应用自己的登录服务签发的短期用户令牌，不接收平台 `appkey` 或模型密钥。默认会话族是 `sdk1`，调用走统一 `/api`。`sdk2-offload-v1` 必须显式选择并完成该族要求的接线，不能只改一个字符串。

对照表与错误信封见 [各语言客户端](https://docs.tansr.com/unified-api/clients/)。移动端公开包的版本以 [平台与公开产物](platforms.md) 为准，不从本页推断。

| 语言 | 现在安装 | 不要当成当前 `/api` 包 |
| --- | --- | --- |
| .NET | NuGet `Tansr.Sdk` **0.2.0**；Windows 文件、SQLite、DPAPI 再加同版 `Tansr.Sdk.Windows` | NuGet 上仍列出的 `0.1.0.2` |
| Go | `go get github.com/tansrai/tansr-go@v0.3.0`（Go 1.25+） | `github.com/cpple/tansr-go` 的 `v0.1.0` / `v0.2.0`。升级必须同时改 `go.mod` 和全部 import |
| Rust | `cargo add tansr-sdk@=0.1.0`（Rust 1.85+；Windows 还要 MSVC 与 PATH 上的 NASM） | 无更早 crates.io 版本。Demo 是同版 `tansr-sdk-demo` |
| Python | `python -m pip install tansr-sdk==0.1.0`（公开范围 Python 3.7+） | 无更早 PyPI 版本。Demo 是同版 `tansr-sdk-demo` |
| C++ | GitHub Release [`v0.1.0`](https://github.com/tansrai/tansr-cpp/releases/tag/v0.1.0) 的对应平台静态 SDK，校验 `SHA256SUMS` 后再 `find_package` | Conan Center / vcpkg 公共索引尚未收录，不要写「vcpkg install tansr」 |

## 接入时停在这些边界

- .NET 0.2.0 的通用入口是 `CallAsync`，错误主位是 `UnifiedApiException` 的统一码和 `RetryAction`，不是旧的族码属性。
- Go v0.3.0 相对 v0.2.0 只改模块路径。业务工具用显式注册的函数，不默认开放 shell。`go-chat`、`go-tools`、`go-archive` 是示例命令，不是应用模板。
- Rust 示例命令是 `tansr-chat`、`tansr-tools`、`tansr-archive`，来自 `tansr-sdk-demo` 0.1.0。用户应用自己持有 Tokio runtime。
- Python 同步接口和 asyncio 可以选一个，不要在已有事件循环里再套一个。Windows 上解释器自带的旧 OpenSSL 连不上 HTTPS 时，按 `tansrai/tansr-python` 的发行说明换隔离运行库，不要把证书校验关掉。示例命令是 `tansr-py-chat`、`tansr-py-tools`、`tansr-py-archive`。
- C++ 依赖（curl、c-ares、OpenSSL）按该 Release 的清单自行准备。CMake 不会下载它们。Windows x64、Linux x64、macOS arm64 以外的工具链从源码构建，不把这三份二进制说成通用包。

源码与指南：

- .NET：[tansrai/tansr-net](https://github.com/tansrai/tansr-net)
- Go：[tansrai/tansr-go](https://github.com/tansrai/tansr-go)
- Rust：[tansrai/tansr-rust](https://github.com/tansrai/tansr-rust)（crates.io `tansr-sdk` / `tansr-sdk-demo`）
- Python：[tansrai/tansr-python](https://github.com/tansrai/tansr-python)（PyPI 同名两包）
- C++：[tansrai/tansr-cpp](https://github.com/tansrai/tansr-cpp)

完成时分开写：装到的包版本、是否连上用户自己的 Serve、是否跑通一轮会话。只读了本页不算接入完成。
