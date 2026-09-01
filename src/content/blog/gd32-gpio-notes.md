---
title: GD32 GPIO 外设入门笔记
date: 2026-08-28
description: GD32 GPIO 的基本概念、配置流程和点灯代码模板，附常见的坑位记录。
category: 嵌入式
tags:
  - GD32
  - GPIO
  - 外设
draft: false
---

记录 GD32 GPIO 的学习笔记，以 GD32F4xx 系列为例。

## GPIO 基本概念

GPIO（General Purpose Input/Output）即通用输入输出端口，每个引脚有四种常用模式：

| 模式 | 典型用途 |
| ---- | -------- |
| 输入浮空 | 按键检测（外部上拉时） |
| 输入上/下拉 | 按键检测 |
| 输出推挽 | LED、蜂鸣器 |
| 复用功能 | USART、SPI、PWM 等 |

## 点灯模板

以 PC6 上的 LED 为例，标准固件库写法：

```c
#include "gd32f4xx.h"

void led_init(void)
{
    /* 1. 使能 GPIOC 时钟：不开时钟一切白搭 */
    rcu_periph_clock_enable(RCU_GPIOC);

    /* 2. 配置为输出模式 */
    gpio_mode_set(GPIOC, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE, GPIO_PIN_6);
    gpio_output_options_set(GPIOC, GPIO_OTYPE_PP, GPIO_OSPEED_50MHZ, GPIO_PIN_6);
}

int main(void)
{
    led_init();

    while (1) {
        gpio_bit_toggle(GPIOC, GPIO_PIN_6);   /* 翻转 LED */
        for (volatile uint32_t i = 0; i < 0x100000; i++);  /* 粗略延时 */
    }
}
```

## 配置流程总结

1. **使能时钟**：`rcu_periph_clock_enable()`，最容易忘记的一步
2. **设置模式**：`gpio_mode_set()`
3. **设置输出选项**：`gpio_output_options_set()`
4. **读写电平**：`gpio_bit_set()` / `gpio_bit_reset()` / `gpio_bit_toggle()`

## 踩过的坑

- 忘记使能时钟，引脚完全没反应，而且不报错
- PWM 输出引脚忘记配置为复用模式，量不到波形
- 5V 引脚直接驱动 3.3V 外设，注意电平匹配

> 建议：把常用的初始化代码整理成模板，新建工程直接拷贝，能省很多时间。
