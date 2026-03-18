# PS Lite

一个基于 `React + TypeScript + Electron` 的简易桌面图像编辑器。

当前已实现：
- 图层列表、显隐、拖拽排序
- 画笔、取色、填充、裁剪
- PNG 导出
- `Ctrl+S` 覆盖最近一次导出的文件
- Windows 便携版 `.exe` 打包

## 环境要求

- `Node.js` 22 或更高版本
- `npm` 10 或更高版本
- Windows 10/11

## 安装依赖

```powershell
npm install
```

## 开发模式

启动前端开发环境：

```powershell
npm run dev
```

说明：
- 这会启动 Vite 开发服务器
- 默认地址通常是 `http://localhost:5173`

## 本地构建

构建前端和 Electron 产物：

```powershell
npm run build
```

构建输出目录：
- `dist/`
- `dist-electron/`

## 本地启动

在完成构建后启动 Electron：

```powershell
npm start
```

## 打包为可执行文件

生成 Windows 便携版 `.exe`：

```powershell
npm run dist
```

打包输出目录：
- `release/`

默认生成的可执行文件示例：

```text
release/PS-Lite-0.0.0-portable.exe
```

你可以直接双击这个 `.exe` 启动软件。

## 常用流程

第一次拉项目后：

```powershell
npm install
npm run dist
```

之后如果你修改了代码并想重新生成 `.exe`：

```powershell
npm run dist
```

## 项目结构

```text
src/
  main/        Electron 主进程
  preload/     Electron preload 桥接
  renderer/    React 界面与编辑器逻辑
dist/          前端构建产物
dist-electron/ Electron 构建产物
release/       打包后的 exe
```

## 备注

- 当前打包目标是 Windows `x64 portable`
- 如果后续需要安装版、桌面快捷方式或自定义图标，可以继续扩展 `electron-builder` 配置
