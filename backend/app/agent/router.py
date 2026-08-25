from __future__ import annotations

from app.agent.registry import AgentRegistry


class AgentRouter:
    """Task Classifier → 类型 → 最佳 Agent；同时支持手动锁定（spec #8）。"""

    TASK_TYPES = ["coding", "prompt", "image", "video", "search", "copywriting",
                  "canvas_analyze", "canvas_prompt", "canvas_image", "canvas_video",
                  "canvas_edit", "canvas_skill", "general"]

    # 任务类型 -> 偏好 Agent（可由手动锁定覆盖）
    TYPE_AGENT_MAP = {
        "coding": "default",
        "prompt": "default",
        "image": "default",
        "video": "default",
        "search": "default",
        "copywriting": "default",
        "canvas_analyze": "default",
        "canvas_prompt": "default",
        "canvas_image": "default",
        "canvas_video": "default",
        "canvas_edit": "default",
        "canvas_skill": "default",
        "general": "default",
    }

    def __init__(self) -> None:
        self.registry: AgentRegistry | None = None

    def bind(self, registry: AgentRegistry) -> None:
        self.registry = registry

    def classify(self, message: str) -> str:
        m = (message or "").lower()
        rules = {
            "coding": ["代码", "编程", "bug", "function", "def ", "class ", "python",
                        "javascript", "报错", "实现", "接口", "算法"],
            "image": ["图片", "图像", "插画", "海报", "image", "draw", "poster", "logo", "封面"],
            "video": ["视频", "短片", "广告片", "video", "clip", "storyboard", "分镜"],
            "prompt": ["提示词", "prompt", "咒语", "生成提示", "写一段提示"],
            "search": ["搜索", "查一下", "检索", "最新", "新闻", "news", "search"],
            "copywriting": ["文案", "广告词", "slogan", "标题", "营销", "种草"],
        }
        for t, kws in rules.items():
            if any(k in m for k in kws):
                return t
        return "general"

    def resolve(self, agent_id: str | None, message: str) -> str:
        if agent_id and agent_id != "auto" and self.registry and self.registry.contains(agent_id):
            return agent_id
        t = self.classify(message)
        pref = self.TYPE_AGENT_MAP.get(t, "default")
        if self.registry and self.registry.contains(pref):
            return pref
        if self.registry and self.registry.ids():
            return self.registry.ids()[0]
        return "default"
