from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    name: str
    email: EmailStr


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class AnalysisSnapshot(BaseModel):
    cleaned_data: list[dict[str, Any]]
    metadata: dict[str, Any]
    statistics: dict[str, Any]
    column_groups: dict[str, list[str]]
    chart_data: dict[str, Any]


class AnalysisReportCreate(BaseModel):
    user_id: str
    file_name: str
    summary_stats: dict[str, Any]
    chart_config: dict[str, Any]
    cleaned_data: list[dict[str, Any]]
    metadata: dict[str, Any]
    statistics: dict[str, Any]
    column_groups: dict[str, list[str]]


class AnalysisReportItem(BaseModel):
    id: str
    user_id: str
    file_name: str
    summary_stats: dict[str, Any]
    chart_config: dict[str, Any]
    timestamp: datetime


class AnalysisReportDetail(AnalysisReportItem):
    snapshot: AnalysisSnapshot
