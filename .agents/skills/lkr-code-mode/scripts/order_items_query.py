# ruff: noqa: F821
"""Run an inline query on <model_name> / order_items with status filter."""


def main():
    return run_inline_query(  # ty: ignore[unresolved-reference]
        result_format="json",
        body={
            "model": "<model_name>",
            "view": "order_items",
            "fields": [
                "order_items.created_year",
                "users.count",
            ],
            "filters": {
                "order_items.status": "Returned",
            },
            "sorts": ["order_items.created_year desc"],
            "limit": "500",
        },
    )


main()
