"""CapabilityChecker — RenderPlan 能力校验（规格书 §5）。"""
from __future__ import annotations

from typing import Optional
from app.render_kernel.schemas.render_plan import RenderPlan
from app.render_kernel.registry.capability import resolve_capabilities


class CapabilityError(Exception):
    pass


class CapabilityChecker:
    """
    检查 RenderPlan 请求的能力需求是否能被已知模型满足。
    """

    def check_plan(self, plan: RenderPlan) -> list[str]:
        """
        校验 plan.capability_required 是否均能被满足。
        返回警告信息列表（空 = 全部满足）。
        """
        if not plan.capability_required:
            return []

        warnings: list[str] = []
        caps = resolve_capabilities(plan.capability_required)

        if not caps:
            warnings.append(
                f"[WARN] 无法找到满足 capability_required={plan.capability_required} "
                f"的渲染引擎，将使用 fallback。"
            )
        else:
            # 检查分辨率是否超限
            max_res = max(c.max_resolution for c in caps)
            img_w = plan.image.width
            img_h = plan.image.height
            if img_w > max_res or img_h > max_res:
                warnings.append(
                    f"[WARN] 请求分辨率 {img_w}x{img_h} 超过引擎上限 {max_res}px，"
                    f"将自动裁剪到 {max_res}x{max_res}。"
                )

        # 视频超长告警
        if plan.video.duration > 30.0:
            warnings.append(
                f"[INFO] 视频时长 {plan.video.duration}s > 30s，"
                f"部分引擎可能不支持。"
            )

        return warnings

    def check(self, plan: RenderPlan) -> None:
        """
        直接抛异常而非返回列表（适合内部强校验）。
        """
        warns = self.check_plan(plan)
        if warns:
            # 只对 ERROR 级别抛异常，WARN 打印
            critical = [w for w in warns if "[ERR]" in w]
            if critical:
                raise CapabilityError("\n".join(critical))


def check_render_plan(plan: RenderPlan) -> list[str]:
    """快捷函数。"""
    return CapabilityChecker().check_plan(plan)
