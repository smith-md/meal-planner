"""Persistent fridge/pantry inventory, credited when a grocery is checked off.

Stock is global (no week reference) so it survives clearing the list and opening new weeks.
Each credit carries a client-generated single-use purchase_id, recorded in the same
transaction as the credit, so retries and repeated check-offs credit only once.
"""
from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, pairings


def serialize_item(row):
    ingredient = pairings.Ingredient(0, row.unit, row.item)
    unit = "" if row.unit == "piece" else row.unit
    return {
        "id": row.id,
        "item": row.item,
        "unit": unit,
        "quantity": ingredient.display_quantity(row.base_quantity),
        "location": row.location,
    }


def serialize_purchase(purchase, replayed):
    return {
        "purchase_id": purchase.purchase_id,
        "amount": purchase.amount,
        "location": purchase.inventory_item.location,
        "reverted": purchase.reverted,
        "replayed": replayed,
        "inventory": serialize_item(purchase.inventory_item),
    }


def _find_purchase(db: Session, purchase_id):
    return db.query(models.InventoryPurchase).filter_by(purchase_id=purchase_id).first()


def credit_purchase(db: Session, purchase_id, amount, location):
    """Credit the amount once per purchase_id. Returns (purchase, replayed)."""
    for attempt in range(2):
        existing = _find_purchase(db, purchase_id)
        if existing:
            return existing, True
        ingredient = pairings.parse_amount(amount)
        if not ingredient:
            raise HTTPException(400, "Enter an amount like 2 cups of rice.")
        group = pairings.UNIT_GROUPS.get(ingredient.unit, ingredient.unit)
        try:
            row = (
                db.query(models.InventoryItem)
                .filter_by(item=ingredient.item, unit_group=group, location=location)
                .first()
            )
            if not row:
                row = models.InventoryItem(
                    item=ingredient.item, unit_group=group, unit=ingredient.unit,
                    location=location, base_quantity=0.0,
                )
                db.add(row)
                db.flush()
            db.execute(
                update(models.InventoryItem)
                .where(models.InventoryItem.id == row.id)
                .values(base_quantity=models.InventoryItem.base_quantity + ingredient.base_quantity)
            )
            purchase = models.InventoryPurchase(
                purchase_id=purchase_id, inventory_item_id=row.id,
                amount=amount.strip(), base_quantity=ingredient.base_quantity,
            )
            db.add(purchase)
            db.commit()
        except IntegrityError:
            # A duplicate purchase_id or a race creating the stock row: retry once.
            db.rollback()
            if attempt == 1:
                raise
            continue
        db.refresh(purchase)
        db.refresh(row)
        return purchase, False


def revert_purchase(db: Session, purchase_id):
    """Undo a credit (never below zero). Idempotent; the id stays used."""
    purchase = _find_purchase(db, purchase_id)
    if not purchase:
        raise HTTPException(404, "Purchase not found")
    if not purchase.reverted:
        purchase.reverted = True
        db.execute(
            update(models.InventoryItem)
            .where(models.InventoryItem.id == purchase.inventory_item_id)
            .values(base_quantity=models.InventoryItem.base_quantity - purchase.base_quantity)
        )
        db.flush()
        item = db.get(models.InventoryItem, purchase.inventory_item_id)
        db.refresh(item)
        if item.base_quantity < 0:
            item.base_quantity = 0.0
        db.commit()
        db.refresh(purchase)
    return purchase


def list_inventory(db: Session):
    return (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.base_quantity > pairings.EPSILON)
        .order_by(models.InventoryItem.location, models.InventoryItem.item)
        .all()
    )
