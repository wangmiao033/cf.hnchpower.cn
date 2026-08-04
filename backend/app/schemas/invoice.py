"""发票 API 模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class InvoiceRecordCreate(BaseModel):
    invoice_direction: str = "output"
    invoice_type: str | None = None
    digital_invoice_no: str | None = None
    invoice_code: str | None = None
    invoice_no: str | None = None
    invoice_identity_key: str | None = None
    buyer_name: str | None = None
    buyer_tax_no: str | None = None
    seller_name: str | None = None
    seller_tax_no: str | None = None
    title: str | None = None
    tax_no: str | None = None
    invoice_amount: float = 0
    tax_amount: float = 0
    amount_with_tax: float = 0
    invoice_date: str | None = None
    issuer: str | None = None
    invoice_source: str | None = None
    tax_status: str = "normal"
    original_invoice_id: str | None = None
    status: str | None = "未开"
    remark: str | None = None
    verified: bool = False
    verified_amount: float = 0
    verified_record_ids: list[str] = Field(default_factory=list)


class InvoiceRecordUpdate(BaseModel):
    invoice_direction: str | None = None
    invoice_type: str | None = None
    digital_invoice_no: str | None = None
    invoice_code: str | None = None
    invoice_no: str | None = None
    invoice_identity_key: str | None = None
    buyer_name: str | None = None
    buyer_tax_no: str | None = None
    seller_name: str | None = None
    seller_tax_no: str | None = None
    title: str | None = None
    tax_no: str | None = None
    invoice_amount: float | None = None
    tax_amount: float | None = None
    amount_with_tax: float | None = None
    invoice_date: str | None = None
    issuer: str | None = None
    invoice_source: str | None = None
    tax_status: str | None = None
    original_invoice_id: str | None = None
    status: str | None = None
    remark: str | None = None
    verified: bool | None = None
    verified_amount: float | None = None
    verified_record_ids: list[str] | None = None


class InvoiceRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    invoice_direction: str
    invoice_type: str | None
    digital_invoice_no: str | None
    invoice_code: str | None
    invoice_no: str | None
    invoice_identity_key: str | None
    buyer_name: str | None
    buyer_tax_no: str | None
    seller_name: str | None
    seller_tax_no: str | None
    title: str | None
    tax_no: str | None
    invoice_amount: float
    tax_amount: float
    amount_with_tax: float
    invoice_date: str | None
    issuer: str | None
    invoice_source: str | None
    tax_status: str
    original_invoice_id: str | None
    status: str | None
    remark: str | None
    verified: bool
    verified_amount: float
    verified_record_ids: list[str]
    created_at: datetime
    updated_at: datetime

    @field_validator("verified_record_ids", mode="before")
    @classmethod
    def _coerce_verified_ids(cls, v: object) -> list[str]:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x) for x in v if x is not None]
        return []


class InvoiceRecordListResponse(BaseModel):
    items: list[InvoiceRecordRead]
    total: int


class InvoiceRecordImportRequest(BaseModel):
    items: list[InvoiceRecordCreate] = Field(default_factory=list, max_length=2000)
    source_file: str | None = None


class InvoiceRecordImportResponse(BaseModel):
    created: int
    updated: int
    skipped: int
    total: int
