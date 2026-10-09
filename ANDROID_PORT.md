# Folia for Android

Folia 的非官方 Android 移植版。工程完全内置。

## 当前结构

```text
Folia React/Vite 前端
  -> Capacitor Android WebView
  -> FoliaNativeBridge JavaScript 兼容层
  -> FoliaNative Capacitor 插件
  -> Android CookieManager / OkHttp
```

扩展中的 `api/folia.js`、网易云、QQ、酷狗适配代码已复制到：

```text
src/nativeBridge/api/
src/nativeBridge/vendor/
```

Android 启动时会在 `src/index.tsx` 安装原生桥，模拟浏览器扩展的 `chrome.cookies`、`chrome.storage`、网络请求和 `FOLIA_API_REQUEST` 消息协议。

## 构建环境

- Node.js 24
- JDK 21（Capacitor 8 的 source/target 级别是 21，必须用 JDK 21；工程里通过 `android/gradle.properties` 的 `org.gradle.java.home` 指定）
- Android Studio
- Android SDK 36.1
- Android Build Tools 36.x

本机已验证路径：

```text
JDK 21:      C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot
Android SDK: C:\Users\whycf\Android\Sdk
```

## 安装 JS 依赖

```powershell
npm install
```

## 构建网页产物

```powershell
$env:VITE_NETEASE_API_BASE='extension'
$env:VITE_QQ_API_BASE='extension'
$env:VITE_KUGOU_API_BASE='extension'
npm run build:capacitor
```

## 同步 Android 工程

```powershell
npx cap sync android
```

## 生成调试 APK

Windows：

```powershell
$env:ANDROID_HOME='C:\Users\whycf\Android\Sdk'
$env:ANDROID_SDK_ROOT='C:\Users\whycf\Android\Sdk'
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
cd android
.\gradlew.bat assembleDebug
```

APK 输出：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## 当前实现范围

- Android Capacitor 容器
- 内置桥消息协议
- Android CookieManager 兼容层
- OkHttp 网络请求兼容层
- 网易云、QQ、酷狗 API 代码内置
- QQ 收藏、专辑、歌单逻辑保留
- 后台播放前台服务
- 锁屏和通知栏 MediaSession 控制
- Android MediaStore 本地音乐扫描
- App 内本地 HTTP 音频流

## 构建状态

- `npm run build:capacitor` 已通过
- `npx cap sync android` 已通过
- `gradlew assembleDebug` 已通过，产出 `android/app/build/outputs/apk/debug/app-debug.apk`
- APK 包名 `top.izuna.foliamajor`，当前版本 `0.7.15-android.77`（`versionCode` 115），minSdk 24，targetSdk 36

## 尚未完成

- 正式签名和应用商店配置

网易云 / QQ / 酷狗登录与曲库、AI 主题配置、后台播放前台服务、锁屏与通知栏媒体控制、
本地音乐（系统文件管理导入 + 设备音乐库扫描）均已接入，详细改动见提交历史。

## GitHub Actions

上游带过来的工作流大多是桌面版和自建服务的发布流程，跟 Android 版无关，已从本 fork 移除：

```text
.github/workflows/canary-pre-release.yml
.github/workflows/docker-stack-check.yml
.github/workflows/docker-stack-publish.yml
.github/workflows/electron-release.yml
.github/workflows/nightly-pre-release.yml
.github/workflows/release-candidate.yml
.github/workflows/sync-server-docker-publish.yml
```

其中 `nightly-pre-release.yml` 是定时任务（每天 UTC 02:00），会在本仓库里构建并发布会往
Releases 里塞桌面版夜间包，所以优先删掉。

保留的两个：

- `codemap-sync.yml`：push 到 `main` 后自动重生成并提交 `docs/CODEMAP.md`
- `pr-unit-tests.yml`：push 和 PR 时跑前端单元测试

以后从上游合并时，如果上游又改了这些被删掉的工作流，冲突解决方式就是继续保持删除状态。
