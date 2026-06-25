# ⚡ Super SSH

一个基于 Web 的 SSH 可视化终端工具，支持服务器连接管理、远程文件浏览与传输、命令学习等功能。

## 功能特性

### 🔐 SSH 连接
- 支持密码和 SSH 密钥（PEM 格式）两种认证方式
- 支持加密私钥口令（Passphrase）
- 支持 HTTP / SOCKS5 代理设置
- 连接信息可保存到本地，支持编辑、导出/导入 JSON
- 最近连接快速重连
- 连接时长计时显示
- 基于 xterm.js 的全功能 Web 终端，支持 256 色

### 🖥️ 终端增强
- 终端搜索（Ctrl+F）
- 字体大小调节（Ctrl +/-）
- 多主题切换（Dark / Light / Dracula / Monokai）
- 复制选中内容、全屏模式（F11）
- 命令片段库：预设常用运维命令，一键发送或执行
- 快捷键面板（⌨️ 按钮查看）

### 📁 远程文件管理
- 可视化浏览远程服务器文件系统
- 面包屑路径导航、文件筛选与排序（名称/大小/时间）
- 显示文件权限、修改时间
- 支持显示隐藏文件
- **拖拽或点击上传**、下载、删除、新建文件夹/空文件
- **重命名**、**文本预览**（512KB 以内）
- 右键菜单快捷操作
- 文件面板可折叠，扩大终端区域

### 🖥️ 服务器信息
- 连接后查看主机名、系统版本、运行时间
- CPU 核心数、内存、磁盘、负载一览

### 📋 命令学习
- 所有 GUI 操作自动生成对应的 SSH 命令
- 左侧「命令记录」面板实时显示命令
- 命令可一键复制，方便学习
- 不同操作类型用颜色区分（导航/上传/下载/删除/新建）

### 🎨 界面定制
- 支持自定义背景图片（URL 或本地上传）
- 背景透明度可调
- 深色主题，毛玻璃效果

## 项目结构

```
super-ssh/
├── package.json          # 项目配置
├── src/
│   └── server.js         # Node.js 后端 (Express + WebSocket + SSH2)
└── public/
    ├── index.html        # 主页面
    ├── style.css         # 样式文件
    └── app.js            # 前端逻辑
```

## 快速开始

### Docker 一键启动（推荐）

需已安装 [Docker](https://docs.docker.com/get-docker/) 与 Docker Compose。

```bash
cp .env.example .env   # 首次执行；已含国内镜像源配置
docker compose up -d --build
```

或使用脚本：

```bash
chmod +x docker-start.sh
./docker-start.sh
```

访问 http://localhost:3000

停止服务：

```bash
docker compose down
```

#### 无法拉取 `node:20-alpine`（auth.docker.io 连接失败）

这是 Docker Hub 网络问题，常见于国内网络。本项目 **默认已通过 `.env.example` 配置 DaoCloud 镜像源**，按上面步骤复制 `.env` 后重新构建即可：

```bash
docker compose up -d --build
```

`.env` 中相关配置：

```env
NODE_IMAGE=docker.m.daocloud.io/library/node:20-alpine
NPM_REGISTRY=https://registry.npmmirror.com
USE_CN_MIRROR=1
```

若 DaoCloud 不可用，可换其他镜像前缀（保持 `library/node:20-alpine` 路径）：

```env
NODE_IMAGE=docker.1ms.run/library/node:20-alpine
```

或在 Docker Desktop → Settings → Docker Engine 配置 registry mirror 后改回官方镜像：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://hub-mirror.c.163.com"
  ]
}
```

然后设置 `NODE_IMAGE=node:20-alpine` 再构建。

### 发布镜像到中央仓库

#### 方式一：本地手动推送

1. 注册并登录目标仓库：

| 平台 | 登录命令 | 镜像地址示例 |
|------|----------|--------------|
| [Docker Hub](https://hub.docker.com/) | `docker login` | `docker.io/<用户名>/super-ssh` |
| [GitHub Packages (GHCR)](https://github.com/features/packages) | `echo $GITHUB_TOKEN \| docker login ghcr.io -u <用户名> --password-stdin` | `ghcr.io/MMCISAGOODMAN/super-ssh` |
| [阿里云 ACR](https://cr.console.aliyun.com/) | `docker login registry.cn-hangzhou.aliyuncs.com` | `registry.cn-hangzhou.aliyuncs.com/<命名空间>/super-ssh` |

2. 构建并推送（支持 amd64 / arm64）：

```bash
chmod +x docker-publish.sh
./docker-publish.sh docker.io/<你的用户名>/super-ssh
# 或
./docker-publish.sh ghcr.io/MMCISAGOODMAN/super-ssh
```

3. 他人拉取运行：

```bash
docker run -d -p 3000:3000 --name super-ssh ghcr.io/MMCISAGOODMAN/super-ssh:latest
```

#### 方式二：GitHub Actions 自动发布（GHCR）

仓库已配置 `.github/workflows/docker-publish.yml`，推送版本 tag 后自动构建并发布到 GHCR：

```bash
git tag v1.0.0
git push origin v1.0.0
```

也可在 GitHub → Actions → **Publish Docker Image** → **Run workflow** 手动触发。

发布后镜像地址：

```
ghcr.io/MMCISAGOODMAN/super-ssh:1.0.0
ghcr.io/MMCISAGOODMAN/super-ssh:latest
```

> GHCR 首次使用需在 GitHub 仓库 **Settings → Packages** 中将 Package 可见性设为 Public（若需公开拉取）。

### 本地开发

#### 安装依赖

```bash
npm install
```

#### 启动服务

```bash
npm start

```

#### 访问

打开浏览器访问 http://localhost:3000

## 使用说明

### 连接服务器
1. 左侧「连接」标签页填写主机地址、端口、用户名
2. 选择密码或密钥认证方式
3. 点击「连接」按钮
4. 可选：点击「保存」将连接信息存储到本地

### 已保存的连接
- 切换到「已保存」标签页
- 点击连接项或右侧「连接」按钮直接连接
- 悬停显示删除按钮

### 文件操作
- **上传**：点击 `📤 上传` 展开拖拽区域，拖拽或选择文件
- **进入目录**：双击文件夹
- **上级目录**：点击 `↑` 按钮
- **新建文件夹**：点击 `📂 新建`
- **下载/删除**：hover 文件行显示操作按钮，或右键菜单

### 命令记录
- 切换到「命令记录」标签页
- 每次文件操作会自动生成对应 SSH 命令
- 点击命令可一键复制

### 背景设置
1. 点击右上角 `🎨 背景` 按钮
2. 输入图片 URL 或上传本地图片
3. 调节透明度滑块
4. 点击「应用」

## 技术栈

- **后端**：Node.js + Express + WebSocket + ssh2
- **前端**：原生 JS + xterm.js
- **通信**：WebSocket（终端）+ SFTP（文件传输）

## 注意事项

- 密码和密钥保存在浏览器 localStorage 中，请勿在公共设备上使用
- 大文件传输建议使用稳定的网络连接
- 背景图片建议使用高分辨率图片以获得最佳效果
