"""Generic, legal-identity-safe customer-library keyword search for bills.

Search by the customer's full name, short name, tag or tax number, but attach
those fields to a bill ONLY if its saved legal company name exactly matches
the customer's normalized full name. Similar brands are not equal companies.

No customer identity, invoice, contract, payment or bill fields are modified.
"""
from __future__ import annotations

from sqlalchemy import column, exists, func, or_, select, table

CUSTOMERS = table(
    "cf_partner_records",
    column("id"),
    column("name"),
    column("normalized_name"),
    column("short_name"),
    column("tag"),
    column("tax_registration_no"),
)


def normalized_company_sql(value):
    """Use the same normalization as cf_partner_records.normalized_name."""
    return func.lower(func.replace(
        func.replace(
            func.replace(func.coalesce(value, ""), "（", "("),
            "）", ")",
        ),
        " ", "",
    ))


def matching_customer_keyword_exists(bill_legal_name, term: str):
    """Correlate customer search metadata without ever merging legal parties."""
    return exists(
        select(CUSTOMERS.c.id).where(
            CUSTOMERS.c.normalized_name == normalized_company_sql(bill_legal_name),
            or_(
                CUSTOMERS.c.name.ilike(term),
                CUSTOMERS.c.short_name.ilike(term),
                CUSTOMERS.c.tag.ilike(term),
                CUSTOMERS.c.tax_registration_no.ilike(term),
            ),
        )
    )


def global_search_customer_exists_sql() -> str:
    """Fixed SQL predicate used by global R&D/channel search queries.

    The bill alias is fixed. The pattern is a bound parameter, not raw SQL.
    """
    return """
        EXISTS (
            SELECT 1 FROM cf_partner_records AS matched_customer
            WHERE matched_customer.normalized_name =
                LOWER(REPLACE(REPLACE(REPLACE(
                    COALESCE(bill.partner_name, ''),
                    '（', '('), '）', ')'), ' ', ''))
              AND concat_ws(' ',
                  matched_customer.name,
                  matched_customer.short_name,
                  matched_customer.tag,
                  matched_customer.tax_registration_no
              ) ILIKE :pattern
        )
    """
