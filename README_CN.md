# Web Serial Monitor

**🌐 [English](README.md) | [中文](README_CN.md)**

Web Serial Monitor 是一个运行在浏览器中的串口终端与实时数据绘图工具。它通过 Web Serial API 直接连接串口设备，自动识别输入文本中的数值字段，并允许用户将任意字段绑定到曲线。项目不依赖特定的单片机、开发板或固件库。

## 版本迭代

| 版本 | 更新日期 | 主要内容 |
| --- | --- | --- |
| V0.4 | 2026-09-12 | 新增最多三个绘图/控制组件的动态可调工作区，使终端自适应剩余屏幕，统一并优化视觉系统；停止 Demo 时同步停止全部输出，并完善 PID 参数发送。 |
| V0.3.1 | 2026-09-11 | 优化笔记本屏幕高度下的自适应布局，保持连接控制区可见，并通过视口自适应尺寸修复绘图、History 和 Terminal 的重叠问题。 |
| V0.3 | 2026-09-11 | 优化整体视觉质感，扩展遥测工作台布局，支持可缩放与可调整尺寸的绘图，新增 3D 欧拉角 IMU、含 PID 控制器的组件库，以及更完善的终端数据控制。 |
| V0.2 | 2026-09-11 | 遥测工作台、中英文界面、明暗主题、确定性文本解析、动态曲线、持续终端渲染和可拖放组件画布。 |
| V0.1 | 2026-09-09 | 首次提供基于浏览器的串口连接、终端和实时数值绘图功能。 |

## 功能特性

- 直接从支持 Web Serial 的浏览器连接串口设备。
- 支持从 9,600 到 921,600 的常用波特率。
- 在终端中持续查看 RX、TX 和系统消息。
- 向已连接的设备发送字符串或十六进制命令。
- 实时绘制串口数值数据，并支持缩放、拖拽平移和历史浏览。
- 自动识别任意数量的数值字段并进行绑定。
- 自由添加、删除曲线，或一次添加全部可用字段。
- 使用有界缓冲区持续显示终端输出，并支持复制、UTF-8/GBK 接收编码以及文本/HEX 显示。
- 自动解析分隔数值、带标签键值、分组传感器日志和 JSON 数据。
- 无需断开设备即可暂停或清空绘图。
- 无硬件时可使用内置 Demo 数据流。
- 可将 Plot、Button、3D IMU、Dashboard、Gauge、Status、Slider、PID Controller 和 Numeric Readout 组件添加到同一个遥测网格。
- 从左侧组件库将组件拖入遥测控制台，无需离开曲线与终端工作区。
- 支持调整 PID 参数，并显式向已连接设备发送 `PID P=... I=... D=...` 文本命令。
- 支持明亮与暗夜主题。

## 浏览器要求

Web Serial 需要桌面端 Chromium 浏览器，例如 Google Chrome 或 Microsoft Edge。页面必须通过 `https://` 或 `localhost` 提供。

Firefox 和 Safari 目前不提供 Web Serial API。访问串口设备时，浏览器始终会要求用户明确授权。

## 支持的数据格式

每行发送一帧数据，并使用 `\n`、`\r` 或 `\r\n` 结束。

### 普通数值数据

数值可以使用逗号、空格或分号分隔：

```text
24.50,3.30,0.18
```

```cpp
Serial.printf("%.2f,%.2f,%.2f\n", temperature, voltage, current);
```

识别后的字段名称为 `Field 1`、`Field 2`、`Field 3`，依此类推。

### 带标签的键值数据

```text
temperature=24.50 voltage=3.30 current=0.18
```

标签会自动成为可选择的绘图绑定字段。同时支持 `name=value` 和 `name:value`；数值可以是整数、小数、带符号数或科学计数法。

### JSON 数值数据

```json
{"temp":24,"power":{"voltage":3.3,"current":0.18}}
```

嵌套键会生成 `power.voltage`、`power.current` 这样的绑定名称。

### 带标签的 IMU 数据

```text
[17:00:39.525] accel(m/s^2) x=-2.076970 y=-5.401797 z=8.956334  gyro(rad/s) x=-0.719293 y=6.750670 z=0.113315
```

该格式会生成 `accel.x`、`accel.y`、`accel.z`、`gyro.x`、`gyro.y` 和 `gyro.z` 六个绑定字段。

## 开始使用

### 本地运行

环境要求：Node.js 22.13 或更高版本，以及 pnpm。

```bash
git clone https://github.com/lewuq/Web-Serial-Monitor.git
cd Web-Serial-Monitor
pnpm install
pnpm dev
```

使用 Chrome 或 Edge 打开终端中显示的本地地址。

### 生产构建

```bash
pnpm build
```

## 使用方法

1. 使用 Chrome 或 Edge 打开应用。
2. 选择与设备一致的波特率。
3. 点击 **Connect device**，并在浏览器弹窗中选择串口。
4. 等待以换行符结尾的数据到达。
5. 使用 **Add**、**Add all** 或每条曲线的选择框绑定检测到的字段。
6. 需要时通过终端输入框发送命令。
7. 拔出设备前点击 **Disconnect**。

所有串口通信和绘图均在浏览器中完成，无需安装针对某款设备的固件库。
