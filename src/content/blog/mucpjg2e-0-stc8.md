---
title: "stc8"
date: 2026-09-22
tags: []
---

### 关于stc8介绍

[文件]: https://www.yuque.com/office/yuque/0/2023/pdf/27903758/1681119456482-9344d684-99fd-438d-8b05-f9c080352419.pdf?from=https%3A%2F%2Fwww.yuque.com%2Ficheima%2Fstc8h%2Fhsfp6pgneomsg96i

> - STC8A: 字母“A”代表 ADC，是 STC 12 位 ADC 的起航产品
> - STC8F: 无ADC、PWM 和PCA 功能，现 STC8F 的改版芯片与原始的 STC8F 管脚完全兼容，但对STC8F内部设计进行了优化和更新，用户需要修改程序，所以命名为 STC8C
> - STC8C: 字母“C”代表改版，是 STC8F 的改版芯片
> - STC8G: 字母“G”最初是芯片生产时打错字了，后来将错就错，定义 G 系列为“GOOD”系列，STC8G 系列简单易学
> - STC8H: 字母“H”取自“高”的英文单词“High”的首字母，“高”表示“16 位高级 PWM”
>
> 目前主流的位STC8H，其他都属于过去系列

- 内核
  - 超高速 8051 内核 (1T)，比传统 8051 约快 12 倍以上
  - 指令代码完全兼容传统 8051
  - 22 个中断源，4 级中断优先级
  - 支持在线仿真

#### GPIO理解

- 1个端口对应8个引脚

- 每个端口都由一个寄存器控制

- 系列不同，端口数量不同

- 每个引脚可配置4种不同的工作模式

  - 

  - | 工作模式 | PnM1 | PnM0 | 说明                                                         |
    | -------- | ---- | ---- | ------------------------------------------------------------ |
    | 准双向口 | 0    | 0    | 弱上拉，即可输入也可输出 灌电流可达20mA，拉电流为270~150uA   |
    | 推挽输出 | 0    | 1    | 强上拉输出。可达20mA，要加限流电阻                           |
    | 高阻输入 | 1    | 0    | 电流既不能流入也不能流出，但可用于测电平                     |
    | 开漏输出 | 1    | 1    | 内部上拉电阻断开。开漏模式既可读外部状态也可对外输出(高电平或低电平)。如要正确读外部状态或需要对外输出高电平，**需外加上拉电阻**，否则读不到外部状态，也对外输不出高电平。 |

- ```c
  	P5M1 &= ~0x08,	P5M0 &= ~0x08; //准双向口
  	//P5M1 &= ~0x08,	P5M0 |=  0x08; //推挽输出
  	//P5M1 |=  0x08,	P5M0 &= ~0x08; //高阻输入
  	//P5M1 |=  0x08,	P5M0 |=  0x08; //开漏输出
  ```

#### 库函数

- \#include <STC8H.H>与\#include “lcd.h”
  - 查找位置不同，去编译器配置的系统/库头文件路径中找。
- sfr和sbit和关键字
  - SFR (Special Function Register) 即特殊功能寄存器，是单片机内部特定功能模块所对应的寄存器。例如，端口寄存器、定时器/计数器寄存器、串行口寄存器等。这些寄存器通过 sfr 关键字来定义。
  - Bit 是指特定寄存器中的某一位。在 C51 中，可以用 sbit 关键字来定义一个 Bit。
  - sfr 和 sbit 可以在程序中用来对单片机的特定功能寄存器和位进行访问和控制，使用起来比直接操作寄存器更加方便和直观。

#### 逻辑分析仪

- 逻辑分析仪（Logic Analyzer）是一种工具，用于分析数字信号，例如控制信号，时钟信号等等。它可以用于调试和验证数字电路、嵌入式系统等等。

#### 串口UART

> **UART** 
>
> ​	通用异步收发器，只支持异步串口通信；
>
> **USART** 
>
> ​	通用同步/异步收发器，既支持异步通信，也支持同步通信。USART 可以理解为功能更完整的 UART。

- 串口TTL协议

  - 组成：TX;RX
  - 异步串行通信协议，数据传输原理：将数据分成一定的数据帧，在数据帧的首位各加上一个起始位和停止位，数据的长度和奇偶校验位
  - 波特率9600，115200，2400
  - 串口TTL使用的TTL电平，其电压范围是0~5v

- 串口转USB

  - 设置串口参数（如波特率、数据位、停止位等），即可开始进行数据传输。在通信过程中，串口转 USB 设备将串口信号转换为 USB 信号，并将其发送到计算机上，或者将从计算机上接收到的 USB 信号转换为串口信号并发送到外部设备上
  - 常用的芯片：FTDI和CH340

- 串口通信所需要的文件：

  -   发送

    ```c
    #include	"Config.h"
    #include	"GPIO.h"
    #include	"UART.h"
    #include	"Delay.h"
    #include	"NVIC.h"
    #include	"Switch.h"
    
    /*************	功能说明	**************
    双串口全双工中断方式收发通讯程序。
    
    通过PC向MCU发送数据, MCU收到后通过串口把收到的数据原样返回, 默认波特率：115200,N,8,1.
    
    通过开启 UART.h 头文件里面的 UART1~UART4 定义，启动不同通道的串口通信。
    ******************************************/
    
    /******************* IO配置函数 *******************/
    void	GPIO_config(void)
    {
        GPIO_InitTypeDef	GPIO_InitStructure;		//结构定义
    
        GPIO_InitStructure.Pin  = GPIO_Pin_0 | GPIO_Pin_1;		//指定要初始化的IO, GPIO_Pin_0 ~ GPIO_Pin_7
        GPIO_InitStructure.Mode = GPIO_PullUp;	//指定IO的输入或输出方式,GPIO_PullUp,GPIO_HighZ,GPIO_OUT_OD,GPIO_OUT_PP
        GPIO_Inilize(GPIO_P3,&GPIO_InitStructure);	//初始化
    }
    
    /***************  串口初始化函数 *****************/
    void	UART_config(void)
    {
        COMx_InitDefine		COMx_InitStructure;					//结构定义
    
        COMx_InitStructure.UART_Mode      = UART_8bit_BRTx;	//模式, UART_ShiftRight,UART_8bit_BRTx,UART_9bit,UART_9bit_BRTx
        COMx_InitStructure.UART_BRT_Use   = BRT_Timer1;			//选择波特率发生器, BRT_Timer1, BRT_Timer2 (注意: 串口2固定使用BRT_Timer2)
        COMx_InitStructure.UART_BaudRate  = 115200ul;			//波特率, 一般 110 ~ 115200
        COMx_InitStructure.UART_RxEnable  = ENABLE;				//接收允许,   ENABLE或DISABLE
        COMx_InitStructure.BaudRateDouble = DISABLE;			//波特率加倍, ENABLE或DISABLE
        UART_Configuration(UART1, &COMx_InitStructure);		//初始化串口1 UART1,UART2,UART3,UART4
        NVIC_UART1_Init(ENABLE,Priority_1);		//中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
        
        UART1_SW(UART1_SW_P30_P31);		//UART1_SW_P30_P31,UART1_SW_P36_P37,UART1_SW_P16_P17,UART1_SW_P43_P44
    }
    
    
    /**********************************************/
    void main(void)
    {
    
    //    EAXSFR();		/* 扩展寄存器访问使能 */
        GPIO_config();
        UART_config();
        EA = 1;
    
        TX1_write2buff(0x23);	// #
        printf("STC8H8K64U UART1 Test Programme!\r\n");	//UART1发送一个字符串
        PrintString1("STC8H8K64U UART1 Test Programme!\r\n");	//UART1发送一个字符串
    
        while (1)
        {
    
            TX1_write2buff(0x2F); // /
            delay_ms(250);
            delay_ms(250);
            delay_ms(250);
            delay_ms(250);
    
        }
    }
    ```

- 接收

```
#include "Config.h"
#include "GPIO.h"
#include "UART.h"
#include "Delay.h"
#include "NVIC.h"
#include "Switch.h"

void GPIO_config(void) {
    GPIO_InitTypeDef	GPIO_InitStructure;		//结构定义
    GPIO_InitStructure.Pin  = GPIO_Pin_0 | GPIO_Pin_1;		//指定要初始化的IO, P30, P31
    GPIO_InitStructure.Mode = GPIO_PullUp;	//指定IO的输入或输出方式,GPIO_PullUp,GPIO_HighZ,GPIO_OUT_OD,GPIO_OUT_PP
    GPIO_Inilize(GPIO_P3, &GPIO_InitStructure);//初始化
}

void UART_config(void) {
    COMx_InitDefine		COMx_InitStructure;					//结构定义
    COMx_InitStructure.UART_Mode      = UART_8bit_BRTx;	//模式, UART_ShiftRight,UART_8bit_BRTx,UART_9bit,UART_9bit_BRTx
    COMx_InitStructure.UART_BRT_Use   = BRT_Timer1;			//选择波特率发生器, BRT_Timer1, BRT_Timer2 (注意: 串口2固定使用BRT_Timer2)
    COMx_InitStructure.UART_BaudRate  = 115200ul;			//波特率, 一般 110 ~ 115200
    COMx_InitStructure.UART_RxEnable  = ENABLE;				//接收允许,   ENABLE或DISABLE
    COMx_InitStructure.BaudRateDouble = DISABLE;			//波特率加倍, ENABLE或DISABLE
    UART_Configuration(UART1, &COMx_InitStructure);		//初始化串口1 UART1,UART2,UART3,UART4

  	NVIC_UART1_Init(ENABLE,Priority_1);		//中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3

    UART1_SW(UART1_SW_P30_P31);		//UART1_SW_P30_P31,UART1_SW_P36_P37,UART1_SW_P16_P17,UART1_SW_P43_P44
}

void on_uart1_recv() {
    u8 i;
    // RX_Cnt收到的数据个数（字节u8 - unsigned char）
    // 将收到的数据, 按字节逐个循环
    for(i=0; i<COM1.RX_Cnt; i++) {
        u8 dat = RX1_Buffer[i]; //  1 1 1 1  0 0 0 0 -> 0xF0
        TX1_write2buff(dat);	//收到的数据原样返回
    }
}
/**
开启串口调试，接收数据，把收到的数据原样返回

**/
void main() {
    // 初始化IO
    GPIO_config();

    // 初始化UART
    UART_config();

    // 开启中断（全局）必须要写！
    EA = 1;

    // 写一个字节
    TX1_write2buff(0x23);
	// 通过PrintString1输出字符串
    PrintString1("STC8H8K64U UART1 Test Programme!\r\n");	//UART1发送一个字符串
    // 通过printf输出字符串
    printf("STC8H8K64U UART1 Test Programme!\r\n");	//UART1发送一个字符串

    while(1) {
        // 超时计数
        // 一旦收到了一个字节数据，RX_TimeOut会初始化一个值（例如：5）
        if((COM1.RX_TimeOut > 0) && (--COM1.RX_TimeOut == 0))
        {            
            if(COM1.RX_Cnt > 0)
            {
                // 收到数据了，on_uart1_recv();
                on_uart1_recv();
            }
            // 处理完数据，将数据个数清零
            COM1.RX_Cnt = 0;
        }
    	// 注意这里delay代码的位置，属于while
        delay_ms(10);
    }
}
```

- 串口调试配置

  - 功能配置

    - 配置IO的工作模式：如果不配置工作模式，会导致串口不工作。（UART1的当前代码中的引脚`P3.0`和`P3.1`默认是准双向口，可以不配置，但是不要存在侥幸心理，导致其他的串口使用中没有配置准双向口）

    - **配置UART的串口工作模式**`**UART_Mode**`：

      - `UART_ShiftRight`同步移位输出：按位传输，效率低，通常不用。

      - `**UART_8bit_BRTx**`	**8位数据，可变波特率**：常用。发送和接收的数据为8位。

      - `UART_9bit`		9位数据，固定波特率，即无法在运行时动态更改波特率。

      - `UART_9bit_BRTx`	9位数据，可变波特率：发送和接收的数据为9位。最后一位为奇偶校验位。

    - **配置UART的波特率**`**RaudRate**`：根据实际情况来定，波特率越高，传输越快，但是出现丢帧的概率越高。通常`115200`就够用。单位是`bit/s`

    - 配置UART的波特率发生器`BRT_Use`：系统提供了4个发生器，通常一一对应。

      - `BRT_Timer1`

      - `BRT_Timer2`

      - `BRT_Timer3`

      - `BRT_Timer4`

    - 配置UART是否接收`RxEnable`：可以获取RXD接收的数据。
    - 配置UART波特率加倍`BaudRateDouble`：默认不加倍，配置加倍会导致波特率是设定的双倍，过高会导致丢帧。
    - 配置UART中断`Interrupt`和优先级`Priority`：UART的数据收发是通过中断实现的，如果不配置，则无法对外发送数据，TXD和RXD不工作。
    - 配置UART的端口`P_SW`：串口通道可以通过几组引脚来实现，但是需要指明是哪一组。

- 中断开启

  - 由于uart中的发送是通过中断实现的，需要开启，但是STC8还提供了一个总的开关，如果总开关不打开，一样不起作用。

    ```
    EA = 1;
    ```

    

- 传输波形
  - ![img](/images/blog/stc8/1691739578320-41dd9db6-6e4e-41fe-b691-1e7940c41e93.png)

  

#### 中断系统：

- 中断系统是为使 CPU 具有对外界紧急事件的实时处理能力而设置的。

- 当 CPU 正在处理一个中断源请求的时候(执行相应的中断服务程序)，发生了另外一个优先级比它还高的中断源请求。

  - 如果 CPU 能够暂停对原来中断源的服务程序,转而去处理优先级更高的中断请求源处理完以后，再回到原低级中断服务程序，这样的过程称为中断嵌套。

- 中断函数

  - `UART1_int`是中断函数的名称，可以随意取，按照自己的需求定
  - `interrupt`是中断函数的标记，说明当前函数是中断函数
  - `0`是中断次序，这个就需要根据自己业务，查询用户手册来定。

  中断函数，可以理解为回调函数，就是这个函数定义出来了，在什么时机调用，不是我们做的，是系统自己调用的。而我们关心的是，某个事件触发了这个函数调用，我们可以在这个函数中写自己的逻辑。‘

  ```
  void UART1_int (void) interrupt 0
  {
  }
  ● UART1_int是中断函数的名称，可以随意取，按照自己的需求定
  ● interrupt是中断函数的标记，说明当前函数是中断函数
  ● 0是中断次序，这个就需要根据自己业务，查询用户手册来定。
  中断函数，可以理解为回调函数，就是这个函数定义出来了，在什么时机调用，不是我们做的，是系统自己调用的。而我们关心的是，某个事件触发了这个函数调用，我们可以在这个函数中写自己的逻辑。
  
  验证Uart的中断函数
  ```

  

- 用户可以用关**总中断允许位(**EA/IE.7)或相应**中断的允许位**屏蔽相应的中断请求，也可以用打开相应的中断允许位来使 CPU 响应相应的中断申请,每一个中断源可以用软件独立地控制为开中断或关中断状态，部分中断的优先级别均可用软件设置。高优先级的中断请求可以打断低优先级的中断，反之，低优先级的中断请求不可以打断高优先级的中断。当两个相同优先级的中断同时产生时，将由查询次序来决定系统先响应哪个中断。

#### 系统时钟

- 系统时钟是指计算机中用于控制各个设备协调工作的定时器

- 时钟周期

  - 1/时钟主频

- 机器周期

  - 也叫指令周期，

    - 1T或者12T

      12T早期配置，假设时钟为24MHz是，每个时钟周期的时间为12*（1/24M）

      1T为 1 *（1/24M）

- NOP指令

  - 不做任何操作的

#### extern关键字

- extern是C语言中的一个关键字，用于说明一个全局变量或函数的定义不在本文件中，而在其他文件中，告诉编译器该变量或函数已经在别的文件中定义过了。

#### 定时器Timer

- 工作模式指的是计数方式，timer的计数是在主频计数的基础上，来进行数数的。timer有16位的计数器，通过计数器来计数来确定定时器运行的时长，在关键位置触发定时中断。

  > - 不是所有定时器都是16位。定时器计数器的位宽由具体MCU硬件决定，常见有8位、16位和32位等。16位定时器的计数范围通常是0~65535，溢出后回到0。配置定时器时需要根据计数器位宽、定时器时钟频率和预分频值计算溢出时间。

  - **16位自动重装载模式：**可以被设置成定时或者计数两种模式，每当定时器溢出时就会触发中断或者输出信号。
  - 16位不可重装载模式：计数值达到设定值后，定时器就会停止计数，需要重新初始化才能继续计数。
  - 8位自动重装载模式：8位计数器溢出时触发中断或输出信号。
  - 不可屏蔽中断的16位自动重装载模式：16位计数器溢出时触发中断或输出信号，并且可以通过软件或硬件方式清除定时器计数器的值。

​	通常使用**16位自动重装载模式.**

- 中断配置

  - 用于触发回调

- 时钟源

  - 1T 跟随主频
  - 12T进行12分频

- 是否输出高速脉冲

  - TIM_ClkOut`，可以配置`DISABLE`或者`ENABLE

    如果配置`ENABLE`，则端口会同步输出时钟脉冲

- 时钟周期配置

  - ```c
    TIM_InitStructure.TIM_Value     = 65536UL - (MAIN_Fosc / 10000UL);
    ```

  - 其中，`10000UL`表示的就是执行频率，意思就是这个timer回调1秒钟要调用 `10000`次。

    注意时钟周期的取值范围，通过以上数学公式，`(MAIN_Fosc / Timer频率)`不能大于`65536UL`;理论上时钟周期可以无限大，经过测试，最大值为`500000UL`,也就是`2us`调用1次。但是，我们要考虑到，如果timer设置到这么高的频率，你在回调中执行的代码时长就不能超过这个值。

    如果是24M主频，1个时钟周期为 1/24MHz=41.67ns，但是一个指令通常由多个时钟周期组成，一段代码又由多个指令组成，这么一算，可做的操作就很少了。因此我们不要设置得那么大。

#### PWM

- PWM全称是脉宽调制（Pulse Width Modulation），是一种通过改变信号的脉冲宽度来控制电路输出的技术。

- 通过控制  频率  与  占空比 控制设备

- STC8H 系列的单片机内部集成了8 通道 16 位高级PWM 定时器，分成两周期可不同的 PWM，分别命名为 PWMA 和PWMB ，可分别单独设置。

  第一组 PWMA 可配置成4 组互补/对称/死区控制的PWM 或捕捉外部信号。

  第二组 PWMB 可配置成4 路PWM 输出或捕捉外部信号。

  两组 PWM 的时钟频率可分别独立设置。

- 配置代码

  ```c
  void	PWM_config(void)
  {
      PWMx_InitDefine		PWMx_InitStructure;
  		
  	// 配置PWM4
      PWMx_InitStructure.PWM_Mode    =	CCMRn_PWM_MODE2;	//模式,		CCMRn_FREEZE,CCMRn_MATCH_VALID,CCMRn_MATCH_INVALID,CCMRn_ROLLOVER,CCMRn_FORCE_INVALID,CCMRn_FORCE_VALID,CCMRn_PWM_MODE1,CCMRn_PWM_MODE2
      PWMx_InitStructure.PWM_Duty    =  0;								//PWM占空比时间, 0~Period
      PWMx_InitStructure.PWM_EnoSelect  = ENO4P | ENO4N;	//输出通道选择,	ENO1P,ENO1N,ENO2P,ENO2N,ENO3P,ENO3N,ENO4P,ENO4N / ENO5P,ENO6P,ENO7P,ENO8P
      PWM_Configuration(PWM4, &PWMx_InitStructure);
  
  	// 配置PWMA
      PWMx_InitStructure.PWM_Period   = PERIOD;					//周期时间,   0~65535
      PWMx_InitStructure.PWM_DeadTime = 0;					//死区发生器设置, 0~255
      PWMx_InitStructure.PWM_MainOutEnable= ENABLE;			//主输出使能, ENABLE,DISABLE
      PWMx_InitStructure.PWM_CEN_Enable   = ENABLE;			//使能计数器, ENABLE,DISABLE
      PWM_Configuration(PWMA, &PWMx_InitStructure);			//初始化PWM通用寄存器,  PWMA,PWMB
  
  	// 切换PWM4选择PWM4_SW_P26_P27
      PWM4_SW(PWM4_SW_P26_P27);			//PWM4_SW_P16_P17,PWM4_SW_P26_P27,PWM4_SW_P66_P67,PWM4_SW_P34_P33
  
  	// 初始化PWMA的中断
      NVIC_PWM_Init(PWMA,DISABLE,Priority_0);
  }
  ```

- 使能PWM

  - ```
    PWMx_InitStructure.PWM_MainOutEnable= ENABLE;			//主输出使能, ENABLE,DISABLE
    PWMx_InitStructure.PWM_CEN_Enable   = ENABLE;			//使能计数器, ENABLE,DISABLE
    PWM_Configuration(PWMA, &PWMx_InitStructure);			//初始化PWM通用寄存器,  PWMA,PWMB
    ```

- EAXSFR扩展寄存器

  - ```
    EAXSFR();		/* 扩展寄存器访问使能 */
    ```

    由于PWM的配置相关特殊功能寄存器位于扩展RAM区域，访问这些寄存器,需先将P_SW2的BIT7设置为1,才可正常读写。

- 预分频代码；**舵机控制**

  - <img src="./stc8.assets/1690954137870-e3b236a5-942d-43c0-b007-ea931398d0a8.gif" alt="img" style="zoom:200%;" />

  - ```
    #include <Config.h>
    #include <GPIO.h>
    #include <Delay.h>
    #include <UART.h>
    #include <NVIC.h>
    #include <Switch.h>
    #include <STC8H_PWM.h>
    /****
    1. 连接舵机PWM引脚：
    	橙色：P21 -> PWM6
    	红色：5V
    	褐色：GND
    	
    2. 初始化PWM外设
    3. 循环扫描按键
    4. 通过按键修改舵机角度
    
    ****/
    void GPIO_config(){	
    	// 初始化GPIO，P21
    	P2_MODE_OUT_PP(GPIO_Pin_1);
    }
    
    // 1000ms 每隔周期 10ms -> 100Hz
    
    // 预分频系数：可以是[1, 65535]任意值
    #define Prescaler		10
    // 频率
    #define FREQ			50
    // 保证分母 (Prescaler * FREQ) >= 367
    #define PERIOD 		(MAIN_Fosc / (Prescaler * FREQ)) 
    
    PWMx_Duty dutyB;
    void	PWM_config(void)
    {
    	PWMx_InitDefine		PWMx_InitStructure;
    	
    	// 配置PWM6
    	PWMx_InitStructure.PWM_Mode    		= CCMRn_PWM_MODE1;	//模式,		CCMRn_FREEZE,CCMRn_MATCH_VALID,CCMRn_MATCH_INVALID,CCMRn_ROLLOVER,CCMRn_FORCE_INVALID,CCMRn_FORCE_VALID,CCMRn_PWM_MODE1,CCMRn_PWM_MODE2
    	PWMx_InitStructure.PWM_Duty    		= dutyB.PWM6_Duty;	//PWM占空比时间, 0~Period
    	PWMx_InitStructure.PWM_EnoSelect    = ENO6P;			//输出通道选择,	ENO1P,ENO1N,ENO2P,ENO2N,ENO3P,ENO3N,ENO4P,ENO4N / ENO5P,ENO6P,ENO7P,ENO8P
    	PWM_Configuration(PWM6, &PWMx_InitStructure);			//初始化PWM,  PWMA,PWMB
    
    	// 配置PWMB
    	PWMx_InitStructure.PWM_Period   = PERIOD - 1;			//周期时间,   0~65535
    	PWMx_InitStructure.PWM_DeadTime = 0;					//死区发生器设置, 0~255
    	PWMx_InitStructure.PWM_MainOutEnable= ENABLE;			//主输出使能, ENABLE,DISABLE
    	PWMx_InitStructure.PWM_CEN_Enable   = ENABLE;			//使能计数器, ENABLE,DISABLE
    	PWM_Configuration(PWMB, &PWMx_InitStructure);			//初始化PWM通用寄存器,  PWMA,PWMB
    
    	// 设置预分频系数
    	PWMB_Prescaler(Prescaler - 1);
    	
    	// 切换PWM通道
    	PWM6_SW(PWM6_SW_P21);					//PWM6_SW_P21,PWM6_SW_P54,PWM6_SW_P01,PWM6_SW_P75
    	
    	// 初始化PWMB的中断
    	NVIC_PWM_Init(PWMB,DISABLE,Priority_0);
    }
    
    ```

    > **因为 PWM 计数器只有16位，直接使用系统时钟产生50Hz时，所需计数值可能超过65535，因此通过预分频降低PWM计数时钟，使20ms周期能够装入16位计数器。同时分频不能过大，否则会降低PWM的时间分辨率。**

####  电位器（ADC——模数转换器）

- 指标

  - 采样：是指在一定时间间隔内对模拟信号进行测量，并将测量值存储在数字形式的数据中
  - 量化：是将这些连续的模拟信号值离散化为一系列数字值，通常使用二进制表示。 

- 配置代码（stc8）

  - ```
    /******************* AD配置函数 *******************/
    void	ADC_config(void)
    {
    	ADC_InitTypeDef		ADC_InitStructure;		//结构定义
    
    	ADC_InitStructure.ADC_SMPduty   = 31;		//ADC 模拟信号采样时间控制, 0~31（注意： SMPDUTY 一定不能设置小于 10）
    	ADC_InitStructure.ADC_CsSetup   = 0;		//ADC 通道选择时间控制 0(默认),1
    	ADC_InitStructure.ADC_CsHold    = 1;		//ADC 通道选择保持时间控制 0,1(默认),2,3
    	ADC_InitStructure.ADC_Speed     = ADC_SPEED_2X1T;		//设置 ADC 工作时钟频率	ADC_SPEED_2X1T~ADC_SPEED_2X16T
    	ADC_InitStructure.ADC_AdjResult = ADC_RIGHT_JUSTIFIED;	//ADC结果调整,	ADC_LEFT_JUSTIFIED,ADC_RIGHT_JUSTIFIED
    	ADC_Inilize(&ADC_InitStructure);		//初始化
    	ADC_PowerControl(ENABLE);				//ADC电源开关, ENABLE或DISABLE
    	NVIC_ADC_Init(DISABLE,Priority_0);		//中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
    }
    ```

    参数说明：

    1. ​	adc采样时间  **ADC_InitStructure.ADC_SMPduty = 31;**

       1. 给 ADC 内部采样电容充电的时间越充分
       2. 对传感器输出阻抗较大的信号更友好
       3. 但单次 ADC 转换速度会降低
       4. **0~31 SMPDUTY 一定不能设置小于 10**

    2. 通道选择建立时间

       1. ```
          ADC_InitStructure.ADC_CsSetup = 0;
          ```

           ADC **切换模拟通道之后的建立时间**。

    3. 通道保持时间

       1. ```
          ADC_InitStructure.ADC_CsHold = 1;
          ```

          ADC **通道选择保持时间**。

    4. ADC 时钟速度

       1. ```
          ADC_InitStructure.ADC_Speed = ADC_SPEED_2X1T;
          ```

          `ADC_SPEED_2X1T` 是 STC8H ADC 外设定义的工作速度配置。

          具体的 `2X1T ~ 2X16T` 是这个芯片 ADC 时钟分频/周期配置方式。

          **不能简单把它理解成 STM32 的 ADC 时钟配置方式。**

    5. ADC 结果对齐方式

       1. ```
          ADC_InitStructure.ADC_AdjResult = ADC_RIGHT_JUSTIFIED;
          ```

          表示 ADC 转换结果采用**右对齐**。

    6. 流程

       1. ```markdown
                            ADC_config()
                                 │
                  ┌──────────────┼──────────────┐
                  ↓              ↓              ↓
              采样时间       ADC工作时钟      结果对齐
                31          ADC_SPEED_2X1T    右对齐
                  │              │              │
                  └──────────────┼──────────────┘
                                 ↓
                           ADC_Inilize()
                                 │
                                 ↓
                           ADC模块初始化
                                 │
                                 ↓
                        ADC_PowerControl(ENABLE)
                                 │
                                 ↓
                            ADC正常工作
                                 │
                                 ↓
                        ADC中断：关闭
          ```

  - 面试回答    “这个 ADC 初始化配置了什么？”

    - 主要配置了 ADC 的采样时间、通道切换建立和保持时间、ADC 工作时钟以及转换结果的数据对齐方式，然后初始化 ADC 并开启 ADC 电源。同时这里关闭了 ADC 中断，因此后续主要采用软件查询的方式获取 ADC 转换结果。

  - 和stm32比

    - STM32 通常还要配置“通道”

  - 数据读取与转化

    - ```
      result = Get_ADCResult(ADC_CH13);
      v = result * 2.5 / 4096;
      ```

    - ADC为12位精度的，意思是最大值是2的12次方，值为4096.

      ADC的这个最大值，表示的是最大测量范围：

      1. 数值最大为4096
      2. 测量的电压值不能超过基准电压
      3. 基准电压对应的值为4096

      记住：我们用4096表示基准电压。

#### 热敏电阻

- <img src="./stc8.assets/image-20260919230022985.png" alt="image-20260919230022985" style="zoom: 33%;" />

- ![image-20260919230213467](/images/blog/stc8/image-20260919230213467.png)

- 代码

- ```
  #ifndef __NTC_H__
  #define __NTC_H__
  
  #include "Config.h"
  
  // 求绝对值
  #define abs(x)	((x > 0) ? (x) : (-(x)))
  
  #define NTC_GPIO			GPIO_P0
  
  #define NTC_GPIO_PIN	GPIO_Pin_4
  
  #define NTC_ACD_CH		ADC_CH12
  
  // 初始化NTC
  void NTC_init();
  
  // 获取温度值
  int NTC_get_temperature();
  
  #endif
  
  ```

- ```
  #include "NTC.h"
  #include "GPIO.h"
  #include "ADC.h"
  #include "NVIC.h"
  #include <stdio.h>
  
  static void GPIO_config(void) {
      GPIO_InitTypeDef	GPIO_InitStructure;		//结构定义
      GPIO_InitStructure.Pin  = NTC_GPIO_PIN;		//指定要初始化的IO,
      GPIO_InitStructure.Mode = GPIO_HighZ;	//指定IO的输入或输出方式,GPIO_PullUp,GPIO_HighZ,GPIO_OUT_OD,GPIO_OUT_PP
      GPIO_Inilize(NTC_GPIO, &GPIO_InitStructure);//初始化
  }
  
  /******************* AD配置函数 *******************/
  void	ADC_config(void)
  {
  	ADC_InitTypeDef		ADC_InitStructure;		//结构定义
  
  	ADC_InitStructure.ADC_SMPduty   = 31;		//ADC 模拟信号采样时间控制, 0~31（注意： SMPDUTY 一定不能设置小于 10）
  	ADC_InitStructure.ADC_CsSetup   = 0;		//ADC 通道选择时间控制 0(默认),1
  	ADC_InitStructure.ADC_CsHold    = 1;		//ADC 通道选择保持时间控制 0,1(默认),2,3
  	ADC_InitStructure.ADC_Speed     = ADC_SPEED_2X1T;		//设置 ADC 工作时钟频率	ADC_SPEED_2X1T~ADC_SPEED_2X16T
  	ADC_InitStructure.ADC_AdjResult = ADC_RIGHT_JUSTIFIED;	//ADC结果调整,	ADC_LEFT_JUSTIFIED,ADC_RIGHT_JUSTIFIED
  	ADC_Inilize(&ADC_InitStructure);		//初始化
  	ADC_PowerControl(ENABLE);				//ADC电源开关, ENABLE或DISABLE
  	NVIC_ADC_Init(DISABLE,Priority_0);		//中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
  }
  
  // 初始化NTC
  void NTC_init() {
      GPIO_config();
      ADC_config();
  }
  
  static int search_temp(float rst_Rx10){
  	int i, min_index = 0;
  
  	// 计算数组长度
  	int len = sizeof(temp_table) / sizeof(u16);
  	
  	// 记录最小差值 
  	float min_diff = abs(rst_Rx10 - temp_table[0]);
  	
  	for (i = 1; i < len; i++){
  		// 计算数组里每一个阻值和rst_Rx10的差值
  		float diff = abs(rst_Rx10 - temp_table[i]);
  		
  		// 得到差值最小元素对应的索引i
  		if(diff < min_diff){
  			// 如果有更小的差值，赋值
  			min_diff = diff;
  			min_index = i;
  		}
  	}
  	
  	printf("len: %d R: %.2f min_diff: %.2f min_index: %d \n", len, rst_Rx10, min_diff, min_index);
  	
  	return min_index;
  }
  
  // 获取温度值
  int NTC_get_temperature() {
      u16 adc_value;
      float rst_V;
      float rst_R;
      int rst_T;
  
      // 获取对应的ADC值
      adc_value = Get_ADCResult(NTC_ACD_CH);
  
      // adc_value返回的值范围 0 -> 4096
      // 等同于P05引脚的电压值和Vref的占比  1024
      // X = ADC_V  * Vref / 4096
      // 计算电压
      rst_V = adc_value * 2.5 / 4096;
  
      // 计算电阻值
      rst_R = rst_V * 10 / (3.3 - rst_V);
  
      // 9.36KΩ 将阻值兑换成温度
      rst_T = search_temp(rst_R * 100) - 55;
  
      printf("ADC: %d voltage: %.2f R = %.2f T = %d℃ \n", adc_value, rst_V, rst_R, (int)rst_T);
  		
  		return rst_T;
  }
  ```

#### 按键

- 消抖

  - 软件延时法：在按键按下时，使用软件延时一段时间，例如10毫秒，然后再检测按键是否还处于按下状态，如果是，则认为按键有效。这种方法简单易行，但会浪费一定的处理器时间，同时需要根据实际情况调整延时时间。
  - 硬件滤波法：在按键输入引脚上添加RC滤波电路，可以有效地去除按键信号上的瞬间噪声。这种方法对于高频噪声的去除效果较好，但需要一定的电路设计能力。
  - 程序消抖法：在程序中记录按键前后两次的状态，如果两次状态不同，则认为按键有效。这种方法可以根据需要调整检测时间，消抖效果较好，但需要额外的程序设计。

- 代码

  - ```
    #include "Config.h"
    #include "Delay.h"
    #include "GPIO.h"
    #include "UART.h"
    #include "NVIC.h"
    #include "Switch.h"
    
    #define KEY1 P51
    #define KEY2 P52
    #define KEY3 P53
    #define KEY4 P54
    
    void GPIO_config(void) {
    	P5_MODE_IO_PU(GPIO_Pin_1 | GPIO_Pin_2 | GPIO_Pin_3 | GPIO_Pin_4);
    }
    
    
    void UART_config(void) {
        COMx_InitDefine		COMx_InitStructure;					//结构定义
        COMx_InitStructure.UART_Mode      = UART_8bit_BRTx;	//模式, UART_ShiftRight,UART_8bit_BRTx,UART_9bit,UART_9bit_BRTx
        COMx_InitStructure.UART_BRT_Use   = BRT_Timer1;			//选择波特率发生器, BRT_Timer1, BRT_Timer2 (注意: 串口2固定使用BRT_Timer2)
        COMx_InitStructure.UART_BaudRate  = 115200ul;			//波特率, 一般 110 ~ 115200
        COMx_InitStructure.UART_RxEnable  = ENABLE;				//接收允许,   ENABLE或DISABLE
        COMx_InitStructure.BaudRateDouble = DISABLE;			//波特率加倍, ENABLE或DISABLE
        UART_Configuration(UART1, &COMx_InitStructure);		//初始化串口1 UART1,UART2,UART3,UART4
    
      	NVIC_UART1_Init(ENABLE,Priority_1);		//中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
        UART1_SW(UART1_SW_P30_P31);		// 引脚选择, UART1_SW_P30_P31,UART1_SW_P36_P37,UART1_SW_P16_P17,UART1_SW_P43_P44
    }
    
    
    #define	DOWN	0
    #define	UP		1
    
    u8 last_key_states[] = {UP, UP, UP, UP};		// key的最后一次状态
    
    // 判断指定位置【是否是】按下或抬起
    #define	IS_KEY_DOWN(i)		last_key_states[i] == DOWN
    #define	IS_KEY_UP(i)		last_key_states[i] == UP
    
    // 将指定位置值【设置】为按下或抬起
    #define SET_KEY_DOWN(i)		last_key_states[i] = DOWN
    #define SET_KEY_UP(i)		last_key_states[i] = UP
    
    void main(){
    	
    	GPIO_config();
    	UART_config();
    	
    	EA = 1;
    	
    	while(1){
    		if(KEY1 && IS_KEY_DOWN(0)){ // 这次是抬起Up 1, 上一次是按下Down 0
    			printf("KEY1 up\n");
    			SET_KEY_UP(0);
    		}else if(!KEY1 && IS_KEY_UP(0)){// 这次是按下Down 0, 上一次是抬起Up 1
    			printf("KEY1 down\n");	
    			SET_KEY_DOWN(0);
    		}
    		
    		if(KEY2 && IS_KEY_DOWN(1)){ // 这次是抬起Up 1, 上一次是按下Down 0
    			printf("KEY2 up\n");
    			SET_KEY_UP(1);
    		}else if(!KEY2 && IS_KEY_UP(1)){// 这次是按下Down 0, 上一次是抬起Up 1
    			printf("KEY2 down\n");	
    			SET_KEY_DOWN(1);
    		}
    		
    		if(KEY3 && IS_KEY_DOWN(2)){ // 这次是抬起Up 1, 上一次是按下Down 0
    			printf("KEY3 up\n");
    			SET_KEY_UP(2);
    		}else if(!KEY3 && IS_KEY_UP(2)){// 这次是按下Down 0, 上一次是抬起Up 1
    			printf("KEY3 down\n");	
    			SET_KEY_DOWN(2);
    		}
    		
    		if(KEY4 && IS_KEY_DOWN(3)){ // 这次是抬起Up 1, 上一次是按下Down 0
    			printf("KEY4 up\n");
    			SET_KEY_UP(3);
    		}else if(!KEY4 && IS_KEY_UP(3)){// 这次是按下Down 0, 上一次是抬起Up 1
    			printf("KEY4 down\n");	
    			SET_KEY_DOWN(3);
    		}
    		
    		delay_ms(20);
    	}
    }
    ```

  - 使用位操作存储状态

    ```
    // P51, P52, P53, P54
    //u8 last_key_states[] = {UP, UP, UP, UP}; 
    // 0b 0 0 0 0 - 1 1 1 1
    u8 last_key_states = 0x0F; 	// KEY最后一次状态的8个位（只使用低4位）
    
    // 判断指定位置【是否】是按下
    //  0b 0 0 0 0 - 0 0 0 0
    //& 0b 0 0 0 0 - 0 1 0 0		----- 判断指定位i=2是否是0
    //  0b 0 0 0 0 - 0 0 0 0			== 0
    #define IS_KEY_DOWN(i)			(last_key_states & (1 << i)) == 0
    
    // 判断指定位置【是否】是抬起
    //  0b 0 0 0 0 - 1 1 0 0
    //& 0b 0 0 0 0 - 1 0 0 0		----- 判断指定位i=3是否是1
    //  0b 0 0 0 0 - 1 0 0 0			> 0
    #define IS_KEY_UP(i)			(last_key_states & (1 << i)) > 0
    
    
    // 将指定位置值【设置】为按下
    //   0b 0 0 0 0 - 1 1 0 0			
    //&= 0b 1 1 1 1 - 1 0 1 1		------ 将指定位i=2设置为0，按下
    //&=~0b 0 0 0 0 - 0 1 0 0
    //	 0b 0 0 0 0 - 1 0 0 0		
    #define SET_KEY_DOWN(i)			last_key_states &= ~(1 << i)
    
    // 将指定位置值【设置】为抬起
    //   0b 0 0 0 0 - 1 1 0 0			
    //|= 0b 0 0 0 0 - 0 0 1 0		------ 将指定位i=1设置为1，抬起
    //   0b 0 0 0 0 - 1 1 1 0
    #define SET_KEY_UP(i)			last_key_states |= (1 << i)
    ```


#### 数码管

- 结构

  - 一节数码管
  -  共阳数码管是指将所有发光二极管的阳极接到一起，形成公共阳极（COM）的数码管，共阳数码管在应用的时候，应该将 COM 端口接到正极，当某一段发光二极管的阴极为低电平的时候，相对应的段就点亮，当某一字段的阴极为高电平的时候，相对应段就不亮。 
  - ![image-20260920105145171](/images/blog/stc8/image-20260920105145171.png)

  - ![image-20260920105209030](/images/blog/stc8/image-20260920105209030.png)

  - 2位数码管
    - ![image-20260920105300930](/images/blog/stc8/image-20260920105300930.png)

  - ![image-20260920105407092](/images/blog/stc8/image-20260920105407092.png)

- 移位寄存器

  -  74HC595 是一款 8 位 CMOS 移位寄存器。8 位并行输出端口为可控的三态输出，一 个串行输入端口，可以实现多级芯片串行控制，组成 8n 位（n 为芯片数量）并行输出  。

    优点：通过逻辑操作来控制LED的状态，少量的引脚控制更多的状态。 

  - ![image-20260920110350133](/images/blog/stc8/image-20260920110350133.png)
    - 引脚
      - LATCH_CLOCK:  锁存时钟
      - SHIFT_CLOCK: 移位时钟
      - A:  数据输入信号管脚
      - QA~QH: 将二进制数据信号转化为高低电平输出给数码管
      - SQH: 串行数据输出管脚
  - ![image-20260920110626192](/images/blog/stc8/image-20260920110626192.png)

  - ![image-20260920110709293](/images/blog/stc8/image-20260920110709293.png)

  - 代码

    - ```c
      #include "Config.h"
      #include "GPIO.h"
      #include "Delay.h"
      
      #define	NIXIE_DI	P44	// 数据输入
      #define	NIXIE_SCK	P42	// 移位寄存器
      #define	NIXIE_RCK	P43	// 锁存寄存器
      
      void GPIO_config(void) {
      	GPIO_InitTypeDef	GPIO_InitStructure;		//结构定义
      	GPIO_InitStructure.Pin  = GPIO_Pin_2 | GPIO_Pin_3 | GPIO_Pin_4;		//指定要初始化的IO,
      	GPIO_InitStructure.Mode = GPIO_PullUp;	//指定IO的输入或输出方式,GPIO_PullUp,GPIO_HighZ,GPIO_OUT_OD,GPIO_OUT_PP
      	GPIO_Inilize(GPIO_P4, &GPIO_InitStructure);//初始化
      }
      
      #define GET_BIT_VAL(byte, pos)	(byte & (1 << pos))
      
      int main() {
      		char i;
      		u8 a_dat = 0x12;	// 0001 0010	字母位 5.
      											//&1000	0000
      	
      		u8 b_idx = 0x1F;	// 0001 1111	数字位 
      	
          GPIO_config();
      		
      		// 显示 7.
      		// 0111 1000
      		// 先发字母位 (控制显示的内容)
      		// 8bit，先发出去的会作为高位
      		for(i = 7; i >= 0; i--){ // 0点亮
      			NIXIE_DI = GET_BIT_VAL(a_dat, i);
      			
      			// 寄存器的移位操作
      			NIXIE_SCK = 0;
      			NOP2();
      			NIXIE_SCK = 1;
      			NOP2();
      		}
      		
      		// 再发数字位 （控制显示哪几个）
      		// 1111 1011
      		
      		// 7.7.空7. 7.7.7.7.  -------------------与二级制是反向
      		for(i = 7; i >= 0; i--){ // 只要不是0，就是高电平
      			NIXIE_DI = GET_BIT_VAL(b_idx, i);
      			
      			// 寄存器的移位操作
      			NIXIE_SCK = 0;
      			NOP2();
      			NIXIE_SCK = 1;
      			NOP2();
      		}
      		
      		// 锁存操作
      		NIXIE_RCK = 0;
      		NOP2();
      		NIXIE_RCK = 1;
      		NOP2();
      		
      		
      		
          while(1) {
      				
          }
      }
      ```

#### 蜂鸣器

- timer定时器

  - ```
    #include "Config.h"
    #include "GPIO.h"
    #include "Delay.h"
    
    #include "Timer.h"
    #include "NVIC.h"
    
    #define BUZZER	P00
    
    //			 C`	   D`     E`   F`	  G`	A`	  B`    C``
    u16 hz[] = {1047, 1175, 1319, 1397, 1568, 1760, 1976, 2093};
    
    void GPIO_config() {
        P0_MODE_OUT_PP(GPIO_Pin_0);
    }
    void	Timer_config(u16 hz_value)
    {
        TIM_InitTypeDef		TIM_InitStructure;						//结构定义
        //定时器0做16位自动重装, 中断频率为1000HZ
        TIM_InitStructure.TIM_Mode      = TIM_16BitAutoReload;	//指定工作模式,   TIM_16BitAutoReload,TIM_16Bit,TIM_8BitAutoReload,TIM_16BitAutoReloadNoMask
        TIM_InitStructure.TIM_ClkSource = TIM_CLOCK_1T;		//指定时钟源,     TIM_CLOCK_1T,TIM_CLOCK_12T,TIM_CLOCK_Ext
        TIM_InitStructure.TIM_ClkOut    = DISABLE;				//是否输出高速脉冲, ENABLE或DISABLE
        TIM_InitStructure.TIM_Value     = 65536UL - (MAIN_Fosc / (hz_value * 2));		//初值,
        TIM_InitStructure.TIM_Run       = ENABLE;				//是否初始化后启动定时器, ENABLE或DISABLE
        Timer_Inilize(Timer0,&TIM_InitStructure);				//初始化Timer0	  Timer0,Timer1,Timer2,Timer3,Timer4
        NVIC_Timer0_Init(ENABLE,Priority_0);		//中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
    }
    
    /**
    举例：如下是3个完整周期
    --    --    --    
      |  |  |  |  |  
       --    --    --
    **/
    
    void timer0_func() {
        BUZZER = ~BUZZER;
    }
    
    void main() {
    		u8 idx = 0;
        GPIO_config();
    
    //    Timer_config();
    
        EA = 1;
    
        // 有源蜂鸣器,才可以直接通过高电平响起
        // BUZZER = 1;
    
        // 20-20000Hz
        // 舒适: 1000-4000Hz
    
        while(1) {
    
            Timer_config(hz[idx]);
    
            if(++idx > 7){
                idx = 0;
            }
    				
            delay_ms(250);
            delay_ms(250);
            delay_ms(250);
            delay_ms(250);
    				
        }
    
    }
    ```

    - pwm

    - ```
      #include "Config.h"
      #include "GPIO.h"
      #include "Delay.h"
      
      #include "STC8H_PWM.h"
      #include "Switch.h"
      #include "NVIC.h"
      
      #define BUZZER	P00
      
      //			   C	 D    E 	F	 G	 A	  B	   C`
       u16 hz[] = {523, 587, 659, 698, 784, 880, 988, 1047};
      
      //			 C`	   D`     E`   F`	  G`	A`	  B`    C``
      //u16 hz[] = {1047, 1175, 1319, 1397, 1568, 1760, 1976, 2093};
      
      void GPIO_config() {
          P0_MODE_OUT_PP(GPIO_Pin_0);
      }
      
      //#define PERIOD (MAIN_Fosc / 1000)
      //PWMx_Duty dutyB;
      void	PWM_config(u16 hz_value)
      {
          PWMx_InitDefine		PWMx_InitStructure;
      	
      	u16 Period = MAIN_Fosc / hz_value;
      
          // 配置PWM5
          PWMx_InitStructure.PWM_Mode    		= CCMRn_PWM_MODE1;	//模式,		CCMRn_FREEZE,CCMRn_MATCH_VALID,CCMRn_MATCH_INVALID,CCMRn_ROLLOVER,CCMRn_FORCE_INVALID,CCMRn_FORCE_VALID,CCMRn_PWM_MODE1,CCMRn_PWM_MODE2
          PWMx_InitStructure.PWM_Duty   	 	= (u16)(Period * 0.5);	//PWM占空比时间, 0~Period
          PWMx_InitStructure.PWM_EnoSelect    = ENO5P;			//输出通道选择,	ENO1P,ENO1N,ENO2P,ENO2N,ENO3P,ENO3N,ENO4P,ENO4N / ENO5P,ENO6P,ENO7P,ENO8P
          PWM_Configuration(PWM5, &PWMx_InitStructure);			//初始化PWM,  PWMA,PWMB
      
          // 配置PWMB
          PWMx_InitStructure.PWM_Period   = Period - 1;			//周期时间,   0~65535
          PWMx_InitStructure.PWM_DeadTime = 0;					//死区发生器设置, 0~255
          PWMx_InitStructure.PWM_MainOutEnable= ENABLE;			//主输出使能, ENABLE,DISABLE
          PWMx_InitStructure.PWM_CEN_Enable   = ENABLE;			//使能计数器, ENABLE,DISABLE
          PWM_Configuration(PWMB, &PWMx_InitStructure);			//初始化PWM通用寄存器,  PWMA,PWMB
      
          // 切换PWM通道
          PWM5_SW(PWM5_SW_P00);					//PWM5_SW_P20,PWM5_SW_P17,PWM5_SW_P00,PWM5_SW_P74
      
          // 初始化PWMB的中断
          NVIC_PWM_Init(PWMB,DISABLE,Priority_0);
      }
      /**
      举例：如下是3个完整周期
      --    --    --
        |  |  |  |  |
         --    --    --
      **/
      
      void main() {
          u8 idx = 0;
      	
      	// 扩展寄存器使能
      	EAXSFR();
      	
          GPIO_config();
      	
          EA = 1;
      
          // 有源蜂鸣器,才可以直接通过高电平响起
          // BUZZER = 1;
      
          // 20-20000Hz
          // 舒适: 1000-4000Hz
      
          while(1) {
      
              PWM_config(hz[idx]);
      
              if(++idx > 7) {
                  idx = 0;
              }
      
              delay_ms(250);
              delay_ms(250);
              delay_ms(250);
              delay_ms(250);
      
          }
      
      }
      ```

#### RTC时钟

- RTC时钟(Real Time Clock)是一种实时时钟芯片，通常与微控制器或计算机等设备配合使用，提供高精度的时间和日期信息，以便于设备进行时间相关的操作，如记录数据、定时执行任务、闹钟提醒等。

- 以下是几种常见的RTC时钟芯片及其特点和应用场景：

  1. DS1302：DS1302是一款低功耗时钟模块，集成了时钟、日历和时钟报警功能，能够以BCD格式存储时间和日期信息。它具有低功耗、简单易用、成本低等特点，适用于需要长时间运行且功耗要求较低的应用场景。
  2. DS3231：DS3231是一款高精度的I2C RTC时钟芯片，能够以二进制格式存储时间和日期信息，并具有时钟报警、温度补偿等功能。它具有高精度、低功耗、高可靠性等特点，适用于对时钟精度要求较高的应用场景，如电子钟、精密计时器等。
  3. PCF8563：PCF8563是一款低功耗的I2C RTC时钟芯片，能够以BCD格式存储时间和日期信息，并具有时钟报警、时钟输出等功能。它具有低功耗、集成度高、工作稳定等特点，适用于需要长时间运行且功耗要求较低的应用场景。
  4. RV-4162-C7：RV-4162-C7是一款高精度的I2C RTC时钟芯片，能够以二进制格式存储时间和日期信息，并具有时钟输出、时钟同步、时钟校准等功能。它具有高精度、低功耗、抗干扰能力强等特点，适用于对时钟精度要求较高的应用场景，如高精度计时器、高精度工控系统等。
  5. MCP7940N：MCP7940N是一款低功耗的I2C RTC时钟芯片，能够以BCD格式存储时间和日期信息，并具有时钟输出、时钟同步、时钟报警等功能。它具有低功耗、成本低等特点，适用于需要长时间运行且功耗要求较低的应用场景，如电子钟、自动售货机等。

- ![image-20260920114519078](/images/blog/stc8/image-20260920114519078.png)

- 设备地址

  - ```
    // 设备地址
    #define		PCF8563_ADDR  0x51 << 1
    // 存储地址：时间的存储地址开始位置
    #define		PCF8563_REG_TD   0x02
    ```

- iic环境初始

  - ```
    #include "Config.h"
    #include "GPIO.h"
    #include "Delay.h"
    
    #include "I2C.h"
    #include "UART.h"
    #include "NVIC.h"
    #include "Switch.h"
    /***
    
    1. 初始化IO口,将P32,P33初始化开漏OD模式
    2. 初始化I2C协议 \ UART
    		EAXSFR();
    		EA = 1
    
    3. 通过I2C读取RTC时钟芯片数据
    4. 通过I2C给RTC时钟芯片写数据
    ***/
    
    void GPIO_config() {
        P3_MODE_OUT_OD(GPIO_Pin_2 | GPIO_Pin_3);
    }
    
    void UART_config(void) {
        // >>> 记得添加 NVIC.c, UART.c, UART_Isr.c <<<
        COMx_InitDefine		COMx_InitStructure;					//结构定义
        COMx_InitStructure.UART_Mode      = UART_8bit_BRTx;	//模式, UART_ShiftRight,UART_8bit_BRTx,UART_9bit,UART_9bit_BRTx
        COMx_InitStructure.UART_BRT_Use   = BRT_Timer1;			//选择波特率发生器, BRT_Timer1, BRT_Timer2 (注意: 串口2固定使用BRT_Timer2)
        COMx_InitStructure.UART_BaudRate  = 115200ul;			//波特率, 一般 110 ~ 115200
        COMx_InitStructure.UART_RxEnable  = ENABLE;				//接收允许,   ENABLE或DISABLE
        COMx_InitStructure.BaudRateDouble = DISABLE;			//波特率加倍, ENABLE或DISABLE
        UART_Configuration(UART1, &COMx_InitStructure);		//初始化串口1 UART1,UART2,UART3,UART4
    
        NVIC_UART1_Init(ENABLE,Priority_1);		//中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
        UART1_SW(UART1_SW_P30_P31);		// 引脚选择, UART1_SW_P30_P31,UART1_SW_P36_P37,UART1_SW_P16_P17,UART1_SW_P43_P44
    }
    /****************  I2C初始化函数 *****************/
    void	I2C_config(void)
    {
        I2C_InitTypeDef		I2C_InitStructure;
    
        I2C_InitStructure.I2C_Mode      = I2C_Mode_Master;	//主从选择   I2C_Mode_Master, I2C_Mode_Slave
        I2C_InitStructure.I2C_Enable    = ENABLE;						//I2C功能使能,   ENABLE, DISABLE
        I2C_InitStructure.I2C_MS_WDTA   = DISABLE;					//主机使能自动发送,  ENABLE, DISABLE
        I2C_InitStructure.I2C_Speed     = 13;								//总线速度=Fosc/2/(Speed*2+4),      0~63
        // 400K = 24M / 2 / (Speed * 2 + 4):
        // 400  = 12000 / (Speed * 2 + 4)
        // Speed * 2   = 26
        I2C_Init(&I2C_InitStructure);
        NVIC_I2C_Init(I2C_Mode_Master,DISABLE,Priority_0);	//主从模式, I2C_Mode_Master, I2C_Mode_Slave; 中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
    
        I2C_SW(I2C_P33_P32);					//I2C_P14_P15,I2C_P24_P25,I2C_P33_P32
    }
    
    #define NUMBER	7
    
    void main() {
        // 设备地址 read A3h and write A2h
        u8 dev_addr = 0x51 << 1; 	// (设备地址 << 1) | 0 = 写地址. 
        // 存储地址
        u8 mem_addr = 0x02;
        // 用于接收从机传来的数据
        u8 p[NUMBER];
    	// 保存时间信息
        u8 second, minute, hour, day, week, month;
        u16 year;
    
        // 开启扩展寄存器使能
        EAXSFR();
    
        GPIO_config();
        UART_config();
        I2C_config();
    
        EA = 1;
    
    //		4. 通过I2C给RTC时钟芯片写数据
    //	void I2C_WriteNbyte(u8 dev_addr, u8 mem_addr, u8 *p, u8 number);
    
        printf("--------------------------------read\n");
        while(1) {
    
    		//		3. 通过I2C读取RTC时钟芯片数据
            I2C_ReadNbyte(dev_addr, mem_addr, &p, NUMBER);
        
            printf("%d:%d:%d \n", (int)hour, (int)minute, (int)second);
        
            delay_ms(250);
            delay_ms(250);
            delay_ms(250);
            delay_ms(250);
        }
    }
    ```

  - 寄存器读取

    - ```
      I2C_ReadNbyte(PCF8563_ADDR, 0x02, dat, 7);
      second = (dat[0] & 0x0F) + ((dat[0] >> 4) & 0x07) * 10;
      minute = (dat[1] & 0x0F) + ((dat[1] >> 4) & 0x07) * 10;
      hour = (dat[2] & 0x0F) + ((dat[2] >> 4) & 0x03) * 10;
      day = (dat[3] & 0x0F) + ((dat[3] >> 4) & 0x03) * 10;
      weekday = dat[4] & 0x07;
      month = (dat[5] & 0x0F) + ((dat[5] >> 4) & 0x01) * 10;
      year = ((dat[6] >> 4) & 0x0F) * 10 + (dat[6] & 0x0F);
      year += ((dat[5] >> 7) & 0x01) * 100 + 1900;		
      ```

  - 写入

    - ```
      year = 2023;
      month = 12;
      day = 31;
      weekday = 0;
      hour = 23;
      minute = 59;
      second = 50;
      if(year >= 2100) {
          c = 1;
      }
      tmp[0] = ((second / 10) << 4) + (second % 10);
      tmp[1] = ((minute / 10) << 4) + (minute % 10);
      tmp[2] = ((hour / 10) << 4) + (hour % 10);
      tmp[3] = ((day / 10) << 4) + (day % 10);
      tmp[4] = weekday % 7;
      tmp[5] = (c << 7) + ((month / 10) << 4) + (month % 10);
      tmp[6] = (u8)(((year % 1000) / 10) << 4) + (u8)((year % 1000) % 10);
      I2C_WriteNbyte(PCF8563_ADDR, 0x02, tmp, 7);	
      ```

- 封装

  - ```
    #ifndef __PCF8563_H__
    #define __PCF8563_H__
    
    #include "config.h"
    #include "I2C.h"
    
    #define PCF8563_SCL			P32
    #define PCF8563_SDA			P33
    #define PCF8563_INT			P37
    #define PCF8563_ADDR		0x51 << 1
    #define PCF8563_ADDR_W		0xA2
    #define PCF8563_ADDR_R		0xA3
    
    #define PCF8563_SCL_INIT()	{P3M1 |= 0x04, P3M0 |= 0x04;}
    #define PCF8563_SDA_INIT()	{P3M1 |= 0x08, P3M0 |= 0x08;}
    #define PCF8563_INT_INIT()	{P3M1 &= ~0x80, P3M0 &= ~0x80;}
    
    //u16 year;
    //u8 month, day, weekday, hour, minute, second
    // 定义clock
    typedef struct {
    	u16 year;
    	u8 month;
    	u8 day;
    	u8 weekday;
    	u8 hour;
    	u8 minute;
    	u8 second;
    } Clock_t;
    
    //定义alarm
    typedef struct {
    	u8 hour;
    	u8 enableHour;
    	u8 minute;
    	u8 enableMinute;
    	u8 day;
    	u8 enableDay;
    	u8 weekday;
    	u8 enableWeekday;
    } Alarm_t;
    
    // 国产芯片的HZ1有问题，不要使用，建议使用HZ64
    enum TimerFreq{ HZ4096 = 0, HZ64 = 1, HZ1 = 2, HZ1_60 = 3};
    
    extern void PCF8563_on_alarm(void); 
    extern void PCF8563_on_timer(void); 
    	
    void PCF8563_init(void);
    void PCF8563_get_clock(Clock_t *c);
    void PCF8563_set_clock(Clock_t c);
    
    void PCF8563_enable_alarm();
    void PCF8563_set_alarm(Alarm_t a);
    void PCF8563_disable_alarm();
    
    void PCF8563_enable_timer();
    void PCF8563_set_timer(enum TimerFreq freq, u8 period);
    void PCF8563_disable_timer();
    
    #endif
    ```

  - ```
    #include "PCF8563.h"
    #include <stdio.h>
    
    
    void PCF8563_init(void) {
    	PCF8563_SCL_INIT();
    	PCF8563_SDA_INIT();
    	PCF8563_INT_INIT();
    }
    
    void PCF8563_get_clock(Clock_t *c) {
    	u8 dat[7];
    	I2C_ReadNbyte(PCF8563_ADDR, 0x02, dat, 7);
    	c->second  = (dat[0] & 0x0F) + ((dat[0] >> 4) & 0x07) * 10;
    	c->minute  = (dat[1] & 0x0F) + ((dat[1] >> 4) & 0x07) * 10;
    	c->hour    = (dat[2] & 0x0F) + ((dat[2] >> 4) & 0x03) * 10;
    	c->day 	   = (dat[3] & 0x0F) + ((dat[3] >> 4) & 0x03) * 10;
    	c->weekday =  dat[4] & 0x07;
    	c->month   = (dat[5] & 0x0F) + ((dat[5] >> 4) & 0x01) * 10;
    	c->year    = ((dat[6] >> 4) & 0x0F) * 10 + (dat[6] & 0x0F);
    	c->year   += ((dat[5] >> 7) & 0x01) * 100 + 1900;
    }
    
    void PCF8563_set_clock(Clock_t clk) {
    	u8 tmp[7];
    	u8 c = 0;
    	if(clk.year >= 2000) {
    		c = 1;
    	}
    	tmp[0] = ((clk.second / 10) << 4) + (clk.second % 10);
    	tmp[1] = ((clk.minute / 10) << 4) + (clk.minute % 10);
    	tmp[2] = ((clk.hour   / 10) << 4) + (clk.hour   % 10);
    	tmp[3] = ((clk.day    / 10) << 4) + (clk.day    % 10);
    	tmp[4] = clk.weekday % 7;
    	tmp[5] = (c << 7) + ((clk.month / 10) << 4) + (clk.month % 10);
    	tmp[6] = (u8)(((clk.year % 100) / 10) << 4) + (u8)(clk.year % 10);
    	I2C_WriteNbyte(PCF8563_ADDR, 0x02, tmp, 7);
    }
    
    void PCF8563_enable_alarm() {
    	u8 config;
    	// 先读配置
    	I2C_ReadNbyte(PCF8563_ADDR, 0x01, &config, 1);
    	// 再去设置, 设置的时候别动别人的配置
    	config |= 0x02;
    	config &= ~0x08;//clear clock标记
    	I2C_WriteNbyte(PCF8563_ADDR, 0x01, &config, 1);
    }
    
    void PCF8563_set_alarm(Alarm_t a) {
    	u8 tmp[4];
    	tmp[0] = ((a.minute / 10) << 4) + (a.minute % 10);
    	if(a.enableMinute == 0) {
    		tmp[0] += (1 << 7);
    	}
    	tmp[1] = ((a.hour / 10) << 4) + (a.hour % 10);
    	if(a.enableHour == 0) {
    		tmp[1] += (1 << 7);
    	}
    	tmp[2] = ((a.day / 10) << 4) + (a.day % 10);
    	if(a.enableDay == 0) {
    		tmp[2] += (1 << 7);
    	}
    	tmp[3] = a.weekday % 7;
    	if(a.enableWeekday == 0) {
    		tmp[3] += (1 << 7);
    	}
    	I2C_WriteNbyte(PCF8563_ADDR, 0x09, tmp, 4);
    }
    
    void PCF8563_disable_alarm() {
    	u8 config[1];
    	// 先读配置
    	I2C_ReadNbyte(PCF8563_ADDR, 0x01, config, 1);
    	// 再去设置, 设置的时候别动别人的配置
    	config[0] &= ~0x02;
    	config[0] &= ~0x08;//clear clock标记
    	I2C_WriteNbyte(PCF8563_ADDR, 0x01, config, 1);
    }
    
    void PCF8563_enable_timer() {
    	u8 config;
    	// 先读配置
    	I2C_ReadNbyte(PCF8563_ADDR, 0x01, &config, 1);
    	// 再去设置, 设置的时候别动别人的配置
    	config |= 0x01;
    	config &= ~0x04;//clear timer标记
    	I2C_WriteNbyte(PCF8563_ADDR, 0x01, &config, 1);
    }
    
    void PCF8563_set_timer(enum TimerFreq freq, u8 period) {
    	u8 config;
    	config = freq + (1 << 7);//计数频率 + timer enable
    	I2C_WriteNbyte(PCF8563_ADDR, 0x0E, &config, 1);
    	
    	config = period; // config, period
    	I2C_WriteNbyte(PCF8563_ADDR, 0x0F, &config, 1);
    }
    
    void PCF8563_disable_timer() {
    	u8 config[1];
    	// 先读配置
    	I2C_ReadNbyte(PCF8563_ADDR, 0x01, config, 1);
    	// 再去设置, 设置的时候别动别人的配置
    	config[0] &= ~0x01;
    	config[0] &= ~0x04;//clear timer标记
    	I2C_WriteNbyte(PCF8563_ADDR, 0x01, config, 1);
    }
    
    void Ext_INT3 (void) interrupt INT3_VECTOR
    {
    	u8 config[1];
    	// 先读配置
    	I2C_ReadNbyte(PCF8563_ADDR, 0x01, &config, 1);
     
    	// 判断闹钟是否被激活 Alarm Flag && AIE
    	if((config[0] & 0x08) && (config[0] & 0x02)) {
    		//清除 alarm 标记
    		config[0] &= ~0x08;
    		I2C_WriteNbyte(PCF8563_ADDR, 0x01, config, 1);
    		
    		PCF8563_on_alarm();
    	}
    	// 判断计时器是否被激活 Timer Flag && TIE
    	if((config[0] & 0x04) && (config[0] & 0x01)) {
    		//清除 timer 标记
    		config[0] &= ~0x04;
    		I2C_WriteNbyte(PCF8563_ADDR, 0x01, config, 1);
    		
    		PCF8563_on_timer();
    	}
    }
    
    ```

- BCD

  - 每十进制数用二进制位来表示

  - 10进制数转BCD数：

    ```
    // 十位取出左移4位 + 个位 (得到BCD数) 不保险
    #define WRITE_BCD(val) 	((val / 10) << 4) + (val % 10)
    
    // 十位取出左移4位 + 个位 (得到BCD数) 推荐
    #define DEC_TO_BCD(dec) ((((dec) / 10) << 4) | ((dec) % 10))
    ```

  - BCD数转10进制数

    ```
    // 将高4位乘以10 + 低四位 (得到10进制数) 不保险
    #define READ_BCD(val) 	(val >> 4) * 10 + (val & 0x0F) 
    
    // 将高4位乘以10 + 低四位 (得到10进制数) 推荐
    #define BCD_TO_DEC(bcd) ((((bcd) >> 4) * 10 + ((bcd) & 0x0F))
    ```

    

#### I2C总线

- 基本原理

  - I2C是一种串行通信协议，用于集成电路之间进行数据交换。

- 总线结构

  - I2C总线包括两根信号线：SDA（串行数据线）和SCL（串行时钟线）。这两根信号线共用一个总线，因此在总线上可以连接多个设备。在I2C总线上，每个设备都有一个唯一的地址，用于标识设备。

    SCL线是时钟线，用于控制数据传输的速度和时序；SDA线是数据线，用于传输实际的数据.

    设备的地址通常是由设备制造商确定的，并在设备的数据手册中公布。

    <img src="./stc8.assets/image-20260920144910261.png" alt="image-20260920144910261" style="zoom:50%;" />

- 上拉电阻

  - **总线长度**：总线长度越长，上拉电阻的阻值就应该越小，以保证信号的稳定性。这是因为，总线长度越长，线路上的电容就越大，需要更多的电流来充电和放电，因此上拉电阻的阻值也应该相应地减小。
  - **总线上的设备数量**：总线上连接的设备数量越多，需要更大的电流来充电和放电，以确保信号的稳定性。因此，当总线上连接的设备数量增加时，上拉电阻的阻值也应该相应地减小。
  - **总线上设备的最高工作频率**：I2C总线的时钟频率通常在100kHz到400kHz之间。如果总线上的设备需要使用更高的时钟频率，则上拉电阻的阻值应该相应地减小，以确保设备能够在规定的时间内完成数据的传输。

- 信号电平

  - I2C总线的信号电平是基于器件的供电电压而定的，通常为3.3V或5V。在I2C总线上，**SDA和SCL信号线都是开漏模式**，因此需要外接上拉电阻，以避免信号电平的不确定性。（默认高电平）

- #### 速度

  I2C总线的速度是由其时钟频率决定的。I2C总线的时钟频率通常在100kHz到400kHz之间，其中100kHz是标准模式（Standard Mode），400kHz是快速模式（Fast Mode）。

  - 在标准模式下，I2C总线的时钟频率为100kHz，数据传输速率最高可以达到每秒约10kbps。标准模式适用于大多数的应用场景，可以满足许多设备的数据传输需求。
  - 在快速模式下，I2C总线的时钟频率为400kHz，数据传输速率最高可以达到每秒约40kbps。快速模式适用于一些需要更高速度的应用场景，例如传感器数据采集等。

  此外，I2C总线还支持更高速度的高速模式（High Speed Mode）和超高速模式（Ultra-Fast Mode），它们的时钟频率分别为`1MHz`和`5MHz`。这些高速模式通常用于一些需要非常高速数据传输的应用场景。

  需要注意的是，总线的速度不仅受时钟频率的影响，还受到总线长度、电容负载、上拉电阻大小等因素的影响。因此，在实际应用中，需要根据具体情况来确定总线的速度以确保数据传输的稳定性和可靠性。

- 开发流程

  - 总结起来，I2C总线编程开发步骤为以下：

    1. 引脚功能配置
    2. I2C配置
    3. 总线数据读取或写入

    I2C引脚配置为**开漏（OD）模式**。

    基本上所有的芯片平台都是这种流程，具体的代码写法可能有所差异，但是道理相通

  - 记得开启扩展寄存器使能:

    - ```
      EAXSFR();
      ```

  - 配置IO口为开漏模式

    - ```
      P3_MODE_OUT_OD(GPIO_Pin_2 | GPIO_Pin_3);
      ```

  - I2C配置代码

    - ```
      /****************  I2C初始化函数 *****************/
      void	I2C_config(void)
      {
      	I2C_InitTypeDef		I2C_InitStructure;
      
      	I2C_InitStructure.I2C_Mode      = I2C_Mode_Master;	//主从选择   I2C_Mode_Master, I2C_Mode_Slave
      	I2C_InitStructure.I2C_Enable    = ENABLE;			//I2C功能使能,   ENABLE, DISABLE
      	I2C_InitStructure.I2C_MS_WDTA   = DISABLE;			//主机使能自动发送,  ENABLE, DISABLE
      	I2C_InitStructure.I2C_Speed     = 13;				//总线速度=Fosc/2/(Speed*2+4),  
                                                              // 400k, 24M => 13
                                                              // 100k, 24M => 58
      	I2C_Init(&I2C_InitStructure);
      	NVIC_I2C_Init(I2C_Mode_Master,DISABLE,Priority_0);	//主从模式, I2C_Mode_Master, I2C_Mode_Slave; 中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
      
      	I2C_SW(I2C_P33_P32);					//I2C_P14_P15,I2C_P24_P25,I2C_P33_P32
      }
      ```

    - I2C_MODE：模式，当前是Master还是Slave。

    - I2C_Speed: 速度。100k或者400k，通过`总线速度=Fosc/2/(Speed*2+4)`公式计算。

  - 图示

  - 图示1

  - ![image-20260920152552921](/images/blog/stc8/image-20260920152552921.png)

  - 图示2

    - ![image-20260920152440259](/images/blog/stc8/image-20260920152440259.png)

  - 代码

    ```
    //========================================================================
    // 函数: void I2C_ReadNbyte(u8 dev_addr, u8 mem_addr, u8 *p, u8 number)
    // 描述: I2C读取数据函数.
    // 参数: dev_addr: 设备地址, mem_addr: 存储地址, *p读取数据存储位置, number读取数据个数.
    // 返回: none.
    // 版本: V1.0, 2020-09-15
    //========================================================================
    void I2C_ReadNbyte(u8 dev_addr, u8 mem_addr, u8 *p, u8 number)   /*  DeviceAddress,WordAddress,First Data Address,Byte lenth   */
    {
    	Start();                                //发送起始命令
    	SendData(dev_addr);                     //发送设备地址+写命令
    	RecvACK();
    	SendData(mem_addr);                     //发送存储地址
    	RecvACK();
    	Start();                                //发送起始命令
    	SendData(dev_addr|1);                   //发送设备地址+读命令
    	RecvACK();
    	do
    	{
    		*p = RecvData();
    		p++;
    		if(number != 1) SendACK();          //send ACK
    	}
    	while(--number);
    	SendNAK();                              //send no ACK	
    	Stop();                                 //发送停止命令
    }
    
    ```

    

#### 外部中断

- 触发

  - 上升沿指的是信号从低电平变为高电平的瞬间，下降沿指的是信号从高电平变为低电平的瞬间

  - 配置代码

    - ```
      #include "Exti.h"
      #include "NVIC.h"
      
      /******************** INT配置 ********************/
      void	Exti_config(void)
      {
          EXTI_InitTypeDef	Exti_InitStructure;							//结构定义
      
          Exti_InitStructure.EXTI_Mode      = EXT_MODE_RiseFall;//中断模式,   EXT_MODE_RiseFall,EXT_MODE_Fall
          Ext_Inilize(EXT_INT0,&Exti_InitStructure);				//初始化
          NVIC_INT0_Init(ENABLE,Priority_0);		//中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
      }
      void ext_int0_call(void) {
      	// 当中断触发时的实现逻辑
      }
      
      ```

    - ```
      extern void ext_int0_call();
      //========================================================================
      // 函数: INT0_ISR_Handler
      // 描述: INT0中断函数.
      // 参数: none.
      // 返回: none.
      // 版本: V1.0, 2020-09-23
      //========================================================================
      void INT0_ISR_Handler (void) interrupt INT0_VECTOR		//进中断时已经清除标志
      {
      	ext_int0_call();
      }
      
      ```

#### OLED显示器（IIC）

[SSD1306]: https://item.taobao.com/item.htm?id=560526239956&amp;pisk=fmnSQUXNP_f5J4aR7vp4l4cc6xrIFbtap9wKIvIPpuEJJeMzGDkzakJQAYPVYLqy-kGQGXVzzuduAJhZs7yFzYExH82Ne8eRySeYGbIUzDMhAJHKtLVeEEkoEkqp_C-BbYDk-vpsB0_RkxH0BgQ8ZqYIWkqp_B9S-1wuxfWOXHeQkKwULMQK9yBYMS2C28hLwrCYKJqL9UtGOnpNtAOfmi7xpV83fEqzqmw7kEkaMYHeL8UWYvPAvBiuF1VteSsdv7VdxQMjUQsi3u0I1RlyDgGspA0LlD1v1WmjH03Kn_9Yfxgq7zgXwMNq4JaTvr6dvxM8grnLXhCbnqHrJ0c5dMeo4czQsr9dxyrxbP3tN9viHued4yja1UQRRtaGA-NwhK_h-9t-0l54N9ray-27uK9fw248n-NwhK_h-ze0FSJXh_3h.&amp;sku_properties=1627207%3A28338&amp;spm=a1z10.5-c-s.w4002-24376215607.29.6549544eCgwSoY

  软驱动与硬驱动

- 硬驱动：硬件电路实现（I2C外设）I2C数据的发送与读取，执行效率高，节省CPU的运算资源。
- 软实现：通过代码直接操作IO，进行拉高拉低，实现I2C数据的发送与读取，CPU较累。软实现优点是适用场景广泛，对硬件电路要求没那么严格。如果硬实现无法正常通信，可以尝试用软实现。

官方示例的逻辑为I2C的软件驱动方式，意思是自己通过发送高低电平，模拟I2C的协议，进行I2C通讯。

硬驱动的意思是，我的电路中通过电路设计，可以实现高低电平的变化，这个高低电平的变化遵循了I2C协议，只需要通过寄存器控制就可以打开这个功能。

一些冲突问题：

- I2C是总线，可以有很多从设备，我们扩展板上有时钟设备，也是I2C
- 时钟设备和屏幕应该可以采用I2C同时工作
- 时钟实现为默认的硬驱动
- 屏幕为软驱动
- 他们共用了相同的SCL和SDA引脚

如果不共用的话，一个软实现一个硬实现，不会有问题。共用，则需要修改一方。目前我们将软实现修改为硬实现。

修改 `OLED_WR_Byte`的实现即可

```
void OLED_WR_Byte(u8 dat,u8 mode) {
	u8 reg;
	if(mode) {
		reg = 0x40;
	} else {
		reg = 0x00;
	}
	I2C_WriteNbyte(0x3C << 1, reg, &dat, 1);
}
```

#### 温湿度传感器

DH11

![image-20260921212220946](/images/blog/stc8/image-20260921212220946.png)

- 协议实现

  - ```c
    u8 DHT11_read_data(u8* dat) {
    	u16 count; 
    	u8 i, j;
    	// 主机: 总线拉低至少18ms
    	// 主机发起
    	DHT = 0;
    	delay_ms(19);
    	DHT = 1;
    	count = 0;
    	while(DHT == 1 && count < 25) {
    		count++;
    		delay1us();
    	}
    	if(count > 25) return 1;
    	
    	count = 0;
    	while(DHT == 0 && count < 83) {
    		count++;
    		delay1us();
    	}
    	if(count > 83) return 2;
    	
    	count = 0;
    	while(DHT == 1 && count < 87) {
    		count++;
    		delay1us();
    	}
    	if(count > 87) return 3;
    	
    	// 开始接收数据
    	for(i = 0; i < 5; i++) {
    		for(j = 0; j < 8; j++) {
    			dat[i] <<= 1;
    			// 54us低 23-27高电平 表示0
    			// 54us低 68-74高电平 表示1
    			count = 0;
    			//等待变为高电平
    			while(DHT == 0 && count <= 54) {
    				count++;
    				delay1us();
    			}
    			if(count > 54) return 4;
    			count = 0;
    			// 等待变为低电平
    			while(DHT == 1 && count <= 74) {
    				count++;
    				delay1us();
    			}
    			if(count > 27) {
    				dat[i] |= 1;
    			}
    		}
    	}
    	if(dat[0] + dat[1] + dat[2] + dat[3] != dat[4]) {
    		return 5;
    	}
    	return 0;
    }
    ```

    - 温度转换

      - ```
        u8 DHT11_get_temperature(u8 *humidity, float *temperature) {
        	u8 dat[5];
        	u8 ret;
        	u8 retry = 0;
        	while((ret = DHT11_read_data(dat)) && retry < 10) {
        		retry++;
        	}
        	
        	*humidity = dat[0];// 获得正数部分
            
        	*temperature = dat[2] & 0x7F;// 获得正数部分
        	*temperature += (dat[3] * 0.1);//加上小数部分
        	if(dat[2] & 0x80) {
        		//表示负数
        		*temperature *= -1;
        	}
        	return ret;
        }
        ```

#### 矩阵键盘

- ![image-20260922154142796](/images/blog/stc8/image-20260922154142796.png)

- 一行按钮，代码编写

  ```
  // 记录16个按键状态，0为按下，1为抬起
  u16 key_state = 0xFFFF;
  
  #define KEY_UP		1
  #define KEY_DOWN	0
  // 第n个按键的状态
  #define KEY_STATE(n)		((key_state & (1 << n)) >> n)
  #define SET_KEY_UP(n)		(key_state |= (1 << n))
  #define SET_KEY_DOWN(n)	(key_state &= ~(1 << n))
  
  #define ROW_COL_RESET() {ROW1=1,ROW2=1,ROW3=1,ROW4=1;COL1=1,COL2=1,COL3=1,COL4=1;}
  
  ......
  
  void scan() {
      // 初始都是 高电平
      ROW_COL_RESET();
      NOP1();
  
  		// ROW1
      // 给 row1 低电平，读取COL1的值
      ROW1 = 0;
      NOP1();
  	// 当前是UP，当之前是DOWN，则为UP
  	// 当前是DOWN，当之前是UP，则为DOWN
      if(COL1 != KEY_STATE(0)) {
  		if(COL1) {
              // 修改当前状态为UP
  			SET_KEY_UP(0);
  			printf("K1 Up\r\n");
  		} else {
              // 修改当前状态为DOWN
  			SET_KEY_DOWN(0);
  			printf("K1 Down\r\n");
          }
  	}
      ......
  }
  ```

- ”多行“代码编写

  ```
  #define ROW 4
  #define COL 4
  
  // 记录16个按键状态，0为按下，1为抬起
  u16 key_state = 0xFFFF;
  
  #define KEY_UP		1
  #define KEY_DOWN	0
  // 第n个按键的状态
  #define KEY_STATE(r, c)			((key_state & (1 << (r * ROW + c))) >> (r * ROW + c))
  #define SET_KEY_UP(r, c)		(key_state |= (1 << (r * ROW + c)))
  #define SET_KEY_DOWN(r, c)	(key_state &= ~(1 << (r * ROW + c)))
  
  #define ROW_COL_RESET() {ROW1=1,ROW2=1,ROW3=1,ROW4=1;COL1=1,COL2=1,COL3=1,COL4=1;}
  
  void scan() {
  	u8 i, j;
      for(i = 0; i < ROW; i++) {
          // 初始都是 高电平
          ROW_COL_RESET();
          NOP1();
  
  				ROW_ON(i);
          for(j = 0; j < COL; j++) {
              // 当前是UP，当之前是DOWN，则为UP
              // 当前是DOWN，当之前是UP，则为DOWN
              if(COL_STATE(j) != KEY_STATE(i, j)) {
                  if(COL_STATE(j)) {
                      // 修改当前状态为UP
                      SET_KEY_UP(i, j);
                      printf("(%d, %d) Up\r\n", (int)i, (int)j);
                  } else {
                      // 修改当前状态为DOWN
                      SET_KEY_DOWN(i, j);
                      printf("(%d, %d) Down\r\n", (int)i, (int)j);
                  }
              }
          }
      }
  }
  ```

#### EEPROM（**可擦除可编程只读存储器**）读写

- RAM 断电就没了，而普通 RAM 又不适合长期保存数据；所以需要一种“断电后数据还在、而且 MCU 可以自己修改”的存储器

- 代码编写

  - ```
    #include "Config.h"
    #include "UART.h"
    #include "EEPROM.h"
    #include <string.h>
    
    void UART_config(void) {
        // >>> 记得添加 NVIC.c, UART.c, UART_Isr.c <<<
        COMx_InitDefine		COMx_InitStructure;					//结构定义
        COMx_InitStructure.UART_Mode      = UART_8bit_BRTx;	//模式, UART_ShiftRight,UART_8bit_BRTx,UART_9bit,UART_9bit_BRTx
        COMx_InitStructure.UART_BRT_Use   = BRT_Timer1;			//选择波特率发生器, BRT_Timer1, BRT_Timer2 (注意: 串口2固定使用BRT_Timer2)
        COMx_InitStructure.UART_BaudRate  = 115200ul;			//波特率, 一般 110 ~ 115200
        COMx_InitStructure.UART_RxEnable  = ENABLE;				//接收允许,   ENABLE或DISABLE
        COMx_InitStructure.BaudRateDouble = DISABLE;			//波特率加倍, ENABLE或DISABLE
        UART_Configuration(UART1, &COMx_InitStructure);		//初始化串口1 UART1,UART2,UART3,UART4
    
        NVIC_UART1_Init(ENABLE,Priority_1);		//中断使能, ENABLE/DISABLE; 优先级(低到高) Priority_0,Priority_1,Priority_2,Priority_3
        UART1_SW(UART1_SW_P30_P31);		// 引脚选择, UART1_SW_P30_P31,UART1_SW_P36_P37,UART1_SW_P16_P17,UART1_SW_P43_P44
    }
    
    #define     Max_Length          100      //读写EEPROM缓冲长度
    u8  xdata   tmp[Max_Length];        //EEPROM操作缓冲
    
    void main() {
    
        u16 addr_sector = 0x0000;
        char *str = "HelloWorld!abc123!";
        u16 str_length = strlen(str);	// 获取str的长度
    
        UART_config();
    		
    		EA = 1;
    
        // 擦除扇区, 一次性擦除一个扇区512字节, 从0x0000开始, 0x01FF
    //    EEPROM_SectorErase(u16 EE_address);
        EEPROM_SectorErase(addr_sector);
    
    //    // 写入数据. 字符串\int\long\float
    ////    EEPROM_write_n(u16 EE_address,u8 *DataAddress,u16 number);
        EEPROM_write_n(addr_sector, str, str_length);
    
    
        // 读取数据. 字符串\int\long\float
    //    EEPROM_read_n(u16 EE_address,u8 *DataAddress,u16 number);
        EEPROM_read_n(addr_sector, tmp, str_length);
    		
    		// 添加字符串结束符
    		tmp[str_length] = '\0';
    			
    		printf(">>存储的字符串: %s\n", str);
    		printf(">>读到的字符串: %s\n", tmp);
    		if(strcmp(str, tmp) == 0){
    			printf("两个字符串相等\n");
    		}else {
    			printf("两个字符串不等\n");
    		}
    
        while(1) {
    
        }
    
    }
    ```

    

 
