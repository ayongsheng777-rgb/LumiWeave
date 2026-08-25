"""影视创作节点数据模型（MCP / engine 共用）。"""
from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Any


class StoryParseInput(BaseModel):
    text: str = Field(default="", description="故事原文")
    genre: str = Field(default="科幻", description="类型")
    style: str = Field(default="电影感", description="风格")
    ratio: str = Field(default="16:9", description="画面比例")
    duration: int = Field(default=30, description="目标时长（秒）")


class CharacterDef(BaseModel):
    id: str = ""
    name: str = ""
    description: str = ""
    prompt: str = ""
    style: str = "电影感"
    pose: str = ""
    expression: str = ""
    seed: str = ""


class SceneDef(BaseModel):
    id: str = ""
    name: str = ""
    location: str = ""
    time: str = "白天"
    weather: str = "晴"
    camera: str = "wide shot"
    description: str = ""
    prompt: str = ""
    style: str = "电影感"


class PropDef(BaseModel):
    id: str = ""
    name: str = ""
    description: str = ""
    prompt: str = ""
    bind_type: str = ""
    bind_id: str = ""


class ShotDef(BaseModel):
    shot: int = 1
    camera: str = "medium shot"
    duration: int = 3
    description: str = ""
    prompt: str = ""
    character_id: str = ""
    scene_id: str = ""


class StoryParseResult(BaseModel):
    characters: list[CharacterDef] = Field(default_factory=list)
    scenes: list[SceneDef] = Field(default_factory=list)
    props: list[PropDef] = Field(default_factory=list)
    shots: list[ShotDef] = Field(default_factory=list)


class CharacterGenerateInput(BaseModel):
    name: str = ""
    description: str = ""
    prompt: str = ""
    style: str = "电影感"
    pose: str = ""
    expression: str = ""
    reference_urls: list[str] = Field(default_factory=list)
    seed: str = ""


class SceneGenerateInput(BaseModel):
    name: str = ""
    location: str = ""
    time: str = "白天"
    weather: str = "晴"
    camera: str = "wide shot"
    description: str = ""
    style: str = "电影感"
    reference_urls: list[str] = Field(default_factory=list)


class StoryboardGenerateInput(BaseModel):
    characters: list[CharacterDef] = Field(default_factory=list)
    scenes: list[SceneDef] = Field(default_factory=list)
    genre: str = "科幻"
    style: str = "电影感"
    ratio: str = "16:9"
    total_duration: int = Field(default=30, description="总时长（秒）")


class SubtitleBurnInput(BaseModel):
    video_url: str = ""
    audio_url: str = ""
    subtitle_content: str = ""
    format: str = "srt"
    burn_in: bool = False


class SubtitleResult(BaseModel):
    subtitle_url: str = ""
    format: str = "srt"
    segments: int = 0


class ExportInput(BaseModel):
    format: str = "mp4"
    video_url: str = ""
    subtitle_url: str = ""
    include_storyboard: bool = True
    include_subtitles: bool = True
