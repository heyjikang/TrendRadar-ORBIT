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
        # 思考模式开关：None=不干预（默认），False=关闭思考，True=开启思考
        # 仅部分模型支持（如 vLLM/Qwen 的 chat_template_kwargs.enable_thinking）
        self.enable_thinking = config.get("ENABLE_THINKING")
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
        # 推理模型兜底：只有推理内容、正文为空时是否自动加大 token 重试一次
        retry_on_empty = bool(kwargs.pop("retry_on_empty", True))

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

        # 应用思考模式开关（在 extra_params 合并之后，保证用户自定义的
        # extra_body 不被覆盖）
        self._apply_thinking_switch(params)

        # 调用 LiteLLM（流式），并在循环中做总时长硬上限判断
        content, reasoning_chars, finish_reason = self._stream_once(params, hard_timeout)

        # 推理模型兜底：思考过程耗尽 max_tokens 时，正文可能完全为空。
        # 此时把 token 预算翻倍重试一次（上限 16384），避免直接判失败。
        if not content.strip() and reasoning_chars > 0:
            base_max = int(params.get("max_tokens") or 0)
            retry_max = min(base_max * 2, 16384)
            if retry_on_empty and base_max and retry_max > base_max:
                print(
                    f"[AI] 仅收到推理内容（{reasoning_chars} 字符）且正文为空"
                    f"（finish_reason={finish_reason or 'unknown'}），"
                    f"将 max_tokens 从 {base_max} 提升至 {retry_max} 重试一次"
                )
                retry_params = dict(params)
                retry_params["max_tokens"] = retry_max
                content, reasoning_chars, finish_reason = self._stream_once(
                    retry_params, hard_timeout
                )

        if not content.strip() and reasoning_chars > 0:
            raise RuntimeError(
                f"模型只输出了推理内容（{reasoning_chars} 字符）而正文为空"
                f"（finish_reason={finish_reason or 'unknown'}），"
                f"通常是思考过程耗尽了 max_tokens。请提高 ai.max_tokens，"
                f"或关闭思考模式（config.yaml 设置 ai.enable_thinking: false，"
                f"或环境变量 AI_ENABLE_THINKING=false）"
            )

        return content

    def _apply_thinking_switch(self, params: Dict[str, Any]) -> None:
        """按配置给请求追加思考模式开关（仅显式配置时生效）"""
        if self.enable_thinking is None:
            return
        extra_body = dict(params.get("extra_body") or {})
        template_kwargs = dict(extra_body.get("chat_template_kwargs") or {})
        template_kwargs.setdefault("enable_thinking", bool(self.enable_thinking))
        extra_body["chat_template_kwargs"] = template_kwargs
        params["extra_body"] = extra_body

    def _stream_once(
        self, params: Dict[str, Any], hard_timeout: float
    ) -> tuple[str, int, str]:
        """执行一次流式调用

        Returns:
            (正文内容, 推理内容字符数, finish_reason)
        """
        start = time.monotonic()
        parts: List[str] = []
        reasoning_chars = 0
        finish_reason = ""
        stream = None
        try:
            stream = completion(**params)
            # 兼容非流式返回（部分代理或测试桩不返回可迭代对象）
            if not hasattr(stream, "__iter__"):
                choices = getattr(stream, "choices", None) or []
                if not choices:
                    return "", 0, ""
                message = getattr(choices[0], "message", None)
                content = getattr(message, "content", "") if message is not None else ""
                reason = getattr(choices[0], "finish_reason", None) or ""
                return content or "", 0, reason
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
                reasoning_chars += len(self._extract_delta_reasoning(chunk))
                reason = self._extract_finish_reason(chunk)
                if reason:
                    finish_reason = reason
        finally:
            # 无论正常结束还是超时中断，都显式关闭流，及时释放底层连接
            if stream is not None:
                close = getattr(stream, "close", None)
                if callable(close):
                    try:
                        close()
                    except Exception:
                        pass

        return "".join(parts), reasoning_chars, finish_reason

    @staticmethod
    def _extract_delta_text(chunk: Any) -> str:
        """从流式返回的 chunk 中提取增量正文"""
        return AIClient._extract_delta_field(chunk, ("content",))

    @staticmethod
    def _extract_delta_reasoning(chunk: Any) -> str:
        """从流式返回的 chunk 中提取增量推理内容（思考过程）"""
        return AIClient._extract_delta_field(chunk, ("reasoning_content", "reasoning"))

    @staticmethod
    def _extract_finish_reason(chunk: Any) -> str:
        """从流式返回的 chunk 中提取 finish_reason"""
        try:
            if isinstance(chunk, dict):
                choices = chunk.get("choices") or []
                if not choices:
                    return ""
                return choices[0].get("finish_reason") or ""
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                return ""
            return getattr(choices[0], "finish_reason", None) or ""
        except (AttributeError, IndexError, TypeError):
            return ""

    @staticmethod
    def _extract_delta_field(chunk: Any, fields: tuple) -> str:
        """从流式返回的 chunk 中提取指定字段的增量文本

        兼容三种形式：litellm 对象（chunk.choices[0].delta.<field>）、
        字典（{"choices": [{"delta": {"<field>": ...}}]}），以及内容块 list。
        """
        try:
            if isinstance(chunk, dict):
                choices = chunk.get("choices") or []
                if not choices:
                    return ""
                delta = choices[0].get("delta") or {}
            else:
                choices = getattr(chunk, "choices", None) or []
                if not choices:
                    return ""
                delta = getattr(choices[0], "delta", None)
                if delta is None:
                    return ""

            value = None
            for name in fields:
                value = delta.get(name) if isinstance(delta, dict) else getattr(delta, name, None)
                if value:
                    break

            if value is None:
                return ""
            if isinstance(value, list):
                return "".join(
                    item.get("text", str(item)) if isinstance(item, dict) else str(item)
                    for item in value
                )
            return value if isinstance(value, str) else str(value)
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
