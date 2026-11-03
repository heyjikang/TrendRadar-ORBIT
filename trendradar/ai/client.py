# coding=utf-8
"""
AI 客户端模块

基于 LiteLLM 的统一 AI 模型接口
支持 100+ AI 提供商（OpenAI、DeepSeek、Gemini、Claude、国内模型等）
"""

import os
import time
from typing import Any, Dict, List

import httpx
from litellm import completion


class AIClient:
    """统一的 AI 客户端（基于 LiteLLM）"""

    def __init__(self, config: Dict[str, Any]):
        """
        初始化 AI 客户端

        Args:
            config: AI 配置字典
                - MODEL: 模型标识（格式: provider/model_name）
                - API_KEY: API 密钥
                - API_BASE: API 基础 URL（可选）
                - TEMPERATURE: 采样温度
                - MAX_TOKENS: 最大生成 token 数
                - TIMEOUT: 请求超时时间（秒）
                - NUM_RETRIES: 重试次数（可选）
                - FALLBACK_MODELS: 备用模型列表（可选）
                - EXTRA_PARAMS: 透传给 LiteLLM 的额外参数（可选），如
                  extra_headers、top_p、presence_penalty、stop 等
        """
        self.model = config.get("MODEL", "deepseek/deepseek-chat")
        self.api_key = config.get("API_KEY") or os.environ.get("AI_API_KEY", "")
        self.api_base = config.get("API_BASE", "")
        self.temperature = config.get("TEMPERATURE", 1.0)
        self.max_tokens = config.get("MAX_TOKENS", 5000)
        self.timeout = config.get("TIMEOUT", 120)
        self.num_retries = config.get("NUM_RETRIES", 2)
        self.fallback_models = config.get("FALLBACK_MODELS", [])
        # config.yaml 中 ai.extra_params 的透传参数（如自定义请求头）
        self.extra_params = config.get("EXTRA_PARAMS") or {}
        if not isinstance(self.extra_params, dict):
            print(
                f"[AI] 配置错误: ai.extra_params 应为字典，"
                f"当前为 {type(self.extra_params).__name__}，已忽略"
            )
            self.extra_params = {}

    def chat(
        self,
        messages: List[Dict[str, str]],
        **kwargs
    ) -> str:
        """
        调用 AI 模型进行对话

        Args:
            messages: 消息列表，格式: [{"role": "system/user/assistant", "content": "..."}]
            **kwargs: 额外参数，会覆盖默认配置

        Returns:
            str: AI 响应内容

        Raises:
            Exception: API 调用失败时抛出异常
        """
        # 整体硬上限：从发起请求到收完响应的【总时长】上限（秒）
        hard_timeout = float(kwargs.get("timeout", self.timeout) or self.timeout)
        # 读空闲超时：两次数据之间的最大间隔（秒）。
        # 注意：openai 兼容接口的 timeout 落到 httpx 后只是「读超时」= 两次数据间隔，
        # 只要连接被吊住或持续慢慢吐字，就永远不会触发。因此这里：
        #   1) 用较小的 read 值做「空闲检测」——彻底卡死时能在该时间内中断；
        #   2) 用下面的总时长循环判断 hard_timeout 兜底——持续慢吐字也能被掐断。
        read_timeout = float(
            kwargs.get("read_timeout", max(5, min(60, hard_timeout)))
        )

        # 构建请求参数
        params = {
            "model": self.model,
            "messages": messages,
            "temperature": kwargs.get("temperature", self.temperature),
            # 显式传入 httpx.Timeout，避免把 300 当成「两次数据间隔」而永不触发
            "timeout": httpx.Timeout(
                connect=min(10.0, read_timeout),
                read=read_timeout,
                write=read_timeout,
                pool=min(10.0, read_timeout),
            ),
            "num_retries": kwargs.get("num_retries", self.num_retries),
            # 强制流式：只有流式才能在本地循环里精确判断「总时长」并主动断开
            "stream": True,
        }

        # 添加 API Key
        if self.api_key:
            params["api_key"] = self.api_key

        # 添加 API Base（如果配置了）
        if self.api_base:
            params["api_base"] = self.api_base

        # 添加 max_tokens（如果配置了且不为 0）
        max_tokens = kwargs.get("max_tokens", self.max_tokens)
        if max_tokens and max_tokens > 0:
            params["max_tokens"] = max_tokens

        # 添加 fallback 模型（如果配置了）
        if self.fallback_models:
            params["fallbacks"] = self.fallback_models

        # 合并配置文件中的 extra_params（如自定义请求头 extra_headers），
        # 再用调用方 kwargs 覆盖；两者均不覆盖上方已确定的核心参数，
        # 因此未配置 extra_params 时行为与原先完全一致
        for key, value in {**self.extra_params, **kwargs}.items():
            # read_timeout 是本方法内部消费的参数，不能透传给 LiteLLM
            if key not in params and key != "read_timeout":
                params[key] = value

        # 调用 LiteLLM（流式），并在循环中做总时长硬上限判断
        start = time.monotonic()
        parts: List[str] = []
        stream = None
        try:
            stream = completion(**params)
            for chunk in stream:
                elapsed = time.monotonic() - start
                if elapsed > hard_timeout:
                    raise TimeoutError(
                        f"AI 调用超过总时长上限 {hard_timeout:.0f}s"
                        f"（已 {elapsed:.0f}s），已主动中断连接"
                    )
                text = self._extract_delta_text(chunk)
                if text:
                    parts.append(text)
        finally:
            # 无论正常结束还是超时中断，都显式关闭流，及时释放底层连接
            if stream is not None:
                close = getattr(stream, "close", None)
                if callable(close):
                    try:
                        close()
                    except Exception:
                        pass

        return "".join(parts)

    @staticmethod
    def _extract_delta_text(chunk: Any) -> str:
        """从流式返回的 chunk 中提取增量文本

        兼容三种形式：litellm 对象（chunk.choices[0].delta.content）、
        字典（{"choices": [{"delta": {"content": ...}}]}），以及内容块 list。
        """
        try:
            if isinstance(chunk, dict):
                choices = chunk.get("choices") or []
                if not choices:
                    return ""
                content = (choices[0].get("delta") or {}).get("content")
            else:
                choices = getattr(chunk, "choices", None) or []
                if not choices:
                    return ""
                delta = getattr(choices[0], "delta", None)
                content = getattr(delta, "content", None) if delta is not None else None

            if content is None:
                return ""
            if isinstance(content, list):
                return "".join(
                    item.get("text", str(item)) if isinstance(item, dict) else str(item)
                    for item in content
                )
            return content if isinstance(content, str) else str(content)
        except (AttributeError, IndexError, TypeError):
            return ""

    def validate_config(self) -> tuple[bool, str]:
        """
        验证配置是否有效

        Returns:
            tuple: (是否有效, 错误信息)
        """
        if not self.model:
            return False, "未配置 AI 模型（model）"

        if not self.api_key:
            return False, "未配置 AI API Key，请在 config.yaml 或环境变量 AI_API_KEY 中设置"

        # 验证模型格式（应该包含 provider/model）
        if "/" not in self.model:
            return False, f"模型格式错误: {self.model}，应为 'provider/model' 格式（如 'deepseek/deepseek-chat'）"

        return True, ""
