"""Server-side grocery checklist.

Every entry has a stable entry_key, so creating or importing the same thing twice is a no-op.
Purchase crediting stays in inventory.py: the client credits stock with the entry's purchase_id
and then records the result here. The purchase_id rotates when an entry goes back to unpurchased,
because a reverted id is spent.
"""
import hashlib
import math
import uuid

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, pairings

CLIENT_PREFIXES = {"manual:": "manual", "added:": "added"}
LOCATIONS = ("fridge", "pantry")
UNDO_LIMIT = 500  # matches the list caps of schemas.GroceryUndo


def new_purchase_id():
    return uuid.uuid4().hex


def parsed_fields(text):
    """item, unit_group, unit and base quantity when the text reads like "2 cups rice"."""
    ingredient = pairings.parse_amount(text or "")
    if not ingredient or len(ingredient.item) > 200:  # too long to match anything; keep as plain text
        return {"item": None, "unit_group": None, "unit": None, "quantity_base": None}
    return {
        "item": ingredient.item,
        "unit_group": ingredient.key[1],
        "unit": ingredient.unit,
        "quantity_base": ingredient.base_quantity,
    }


def quantity_text(item, unit, quantity_base):
    if not item or not unit or quantity_base is None or not math.isfinite(quantity_base):
        return None
    return pairings.Ingredient(0, unit, item).display_quantity(quantity_base)


def serialize(entry, replayed=False):
    credit = None
    if entry.credit_amount and entry.credit_location:
        credit = {"amount": entry.credit_amount, "location": entry.credit_location}
    return {
        "id": entry.id,
        "entry_key": entry.entry_key,
        "source": entry.source,
        "week_plan_id": entry.week_plan_id,
        "week_start": entry.week_plan.start_date if entry.week_plan else None,
        "name": entry.name,
        "item": entry.item,
        "unit_group": entry.unit_group,
        "unit": "" if entry.unit == "piece" else entry.unit,
        "quantity": quantity_text(entry.item, entry.unit, entry.quantity_base),
        "quantity_base": entry.quantity_base
        if entry.quantity_base is None or math.isfinite(entry.quantity_base) else None,
        "note": entry.note,
        "purchased": entry.purchased,
        "purchase_id": entry.purchase_id,
        "credit": credit,
        "replayed": replayed,
    }


def restorable(entry):
    """The fields needed to recreate an entry exactly (undo)."""
    data = serialize(entry)
    keep = ("entry_key", "source", "week_plan_id", "name", "item", "unit_group", "quantity_base",
            "note", "purchased", "purchase_id", "credit")
    result = {key: data[key] for key in keep}
    result["unit"] = entry.unit
    return result


def list_entries(db: Session):
    return db.query(models.GroceryEntry).order_by(models.GroceryEntry.id).all()


def covers(entry, week_plan_id):
    """An unpurchased entry covers an ingredient for a week unless it belongs to another week's plan."""
    if entry.purchased:
        return False
    return entry.source != "plan" or entry.week_plan_id == week_plan_id


def find_covering(db: Session, item, unit_group, week_plan_id):
    if not item or not unit_group:
        return None
    rows = (
        db.query(models.GroceryEntry)
        .filter_by(item=item, unit_group=unit_group, purchased=False)
        .order_by(models.GroceryEntry.id)
        .all()
    )
    return next((row for row in rows if covers(row, week_plan_id)), None)


def create_entry(db: Session, entry_key, name, note=None, week_plan_id=None):
    """Create a manual or added entry. Returns (entry, replayed)."""
    source = next((value for prefix, value in CLIENT_PREFIXES.items() if entry_key.startswith(prefix)), None)
    if not source:
        raise HTTPException(400, "Entry keys start with manual: or added:.")
    name = " ".join(name.split())
    if not name:
        raise HTTPException(400, "Enter an item name.")
    existing = db.query(models.GroceryEntry).filter_by(entry_key=entry_key).first()
    if existing:
        return existing, True
    if week_plan_id is not None and not db.get(models.WeekPlan, week_plan_id):
        raise HTTPException(404, "Week plan not found")
    fields = parsed_fields(name)
    if source == "added" and find_covering(db, fields["item"], fields["unit_group"], week_plan_id):
        raise HTTPException(409, "Already on your shopping list.")
    entry = models.GroceryEntry(
        entry_key=entry_key, source=source, week_plan_id=week_plan_id, name=name,
        note=note.strip() if note and note.strip() else None,
        purchased=False, purchase_id=new_purchase_id(), **fields,
    )
    db.add(entry)
    try:
        db.commit()
    except IntegrityError:
        # Another request created the same key first: report that one.
        db.rollback()
        existing = db.query(models.GroceryEntry).filter_by(entry_key=entry_key).first()
        if existing:
            return existing, True
        raise
    db.refresh(entry)
    return entry, False


def update_entry(db: Session, entry_id, fields_set, purchased, credit):
    """Record purchase state. Going back to unpurchased clears the credit and rotates purchase_id."""
    entry = db.get(models.GroceryEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    if "purchased" in fields_set and purchased is not None:
        if entry.purchased and not purchased:
            entry.purchase_id = new_purchase_id()
            entry.credit_amount = None
            entry.credit_location = None
        entry.purchased = purchased
    if "credit" in fields_set:
        if credit is not None and not entry.purchased:
            raise HTTPException(400, "Mark the entry purchased before recording a credit.")
        entry.credit_amount = credit.amount if credit else None
        entry.credit_location = credit.location if credit else None
    db.commit()
    db.refresh(entry)
    return entry


def delete_entry(db: Session, entry_id):
    entry = db.get(models.GroceryEntry, entry_id)
    if entry:
        db.delete(entry)
        db.commit()


def clear_purchased(db: Session):
    count = db.query(models.GroceryEntry).filter_by(purchased=True).delete()
    db.commit()
    return count


def _text(value):
    if value is None:
        return ""
    return str(value).strip()


def import_local(db: Session, raw_entries):
    """Move the old browser-only list here. Keys are legacy:<old id>, so re-sending is harmless.

    Purchased state, credit and purchase id are kept as they were; nothing is credited again.
    """
    existing = {key for (key,) in db.query(models.GroceryEntry.entry_key).all()}
    claimed_ids = {pid for (pid,) in db.query(models.GroceryEntry.purchase_id).all()}
    for index, raw in enumerate(raw_entries):
        if not isinstance(raw, dict):
            continue
        name = " ".join(_text(raw.get("name")).split())[:200]
        if not name:
            continue
        legacy_id = _text(raw.get("id"))
        if not legacy_id:
            legacy_id = f"n{index}-{hashlib.sha1(name.encode('utf-8')).hexdigest()[:10]}"
        key = f"legacy:{legacy_id}"[:300]
        if key in existing:
            continue
        existing.add(key)
        parts = [_text(raw.get("quantity"))[:200], _text(raw.get("unit"))[:200], _text(raw.get("item"))[:200]]
        fields = parsed_fields(" ".join(part for part in parts if part)) if parts[2] else parsed_fields(name)
        if fields["item"] is None and parts[2]:
            fields = parsed_fields(name)
        purchase_id = _text(raw.get("purchaseId"))
        if not 8 <= len(purchase_id) <= 64:
            purchase_id = new_purchase_id()
        elif purchase_id in claimed_ids:
            continue  # that purchase id already belongs to another entry; never share one
        claimed_ids.add(purchase_id)
        purchased = raw.get("purchased") is True
        credit = raw.get("credit") if isinstance(raw.get("credit"), dict) else None
        amount = _text(credit.get("amount"))[:200] if credit else ""
        location = _text(credit.get("location")) if credit else ""
        has_credit = purchased and bool(amount) and location in LOCATIONS
        db.add(models.GroceryEntry(
            entry_key=key, source="legacy", name=name, note=_text(raw.get("note"))[:200] or None,
            purchased=purchased, purchase_id=purchase_id,
            credit_amount=amount if has_credit else None,
            credit_location=location if has_credit else None, **fields,
        ))
    try:
        db.commit()
    except IntegrityError:
        # A concurrent import won the race for some keys; a second pass skips those.
        db.rollback()
        return import_local(db, raw_entries)
    return list_entries(db)


def undo_changes(db: Session, undo):
    """Inverse of a delete or a reconcile apply, keyed by entry_key.

    Purchased entries are never changed or deleted here; only missing entries are recreated.
    """
    for key in undo.added_keys:
        entry = db.query(models.GroceryEntry).filter_by(entry_key=key).first()
        if entry and not entry.purchased:
            db.delete(entry)
    for change in undo.updated:
        entry = db.query(models.GroceryEntry).filter_by(entry_key=change.entry_key).first()
        if entry and not entry.purchased:
            entry.name = change.name
            entry.quantity_base = change.quantity_base
            entry.note = change.note
    present = {key for (key,) in db.query(models.GroceryEntry.entry_key).all()}
    owners = {pid: key for key, pid in db.query(models.GroceryEntry.entry_key, models.GroceryEntry.purchase_id)}
    for old in undo.removed:
        if old.entry_key in present:
            continue
        if owners.get(old.purchase_id, old.entry_key) != old.entry_key:
            db.rollback()
            raise HTTPException(409, "A purchase id in the undo belongs to another entry; nothing was changed.")
        owners[old.purchase_id] = old.entry_key
        if old.week_plan_id is not None and not db.get(models.WeekPlan, old.week_plan_id):
            continue
        has_credit = old.purchased and old.credit is not None
        db.add(models.GroceryEntry(
            entry_key=old.entry_key, source=old.source, week_plan_id=old.week_plan_id, name=old.name,
            item=old.item, unit_group=old.unit_group,
            unit=old.unit or ("piece" if old.item else None),  # serialize() shows piece as ""
            quantity_base=old.quantity_base,
            note=old.note, purchased=old.purchased, purchase_id=old.purchase_id,
            credit_amount=old.credit.amount if has_credit else None,
            credit_location=old.credit.location if has_credit else None,
        ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "The list changed while undoing; nothing was changed.")
    return list_entries(db)
