from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Date, ForeignKey, Float, Boolean, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base


class WeekMeal(Base):
    """A meal planned in a week, with the number of servings planned."""
    __tablename__ = "week_meals"

    id = Column(Integer, primary_key=True)
    week_plan_id = Column(Integer, ForeignKey("week_plans.id"))
    meal_id = Column(Integer, ForeignKey("meals.id"))
    servings = Column(Integer, nullable=True)

    meal = relationship("Meal")


class Meal(Base):
    __tablename__ = "meals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    notes = Column(String, nullable=True)
    tags = Column(String, nullable=True)
    ingredients = Column(String, nullable=True)
    yield_servings = Column(Integer, nullable=True)

    week_plans = relationship("WeekPlan", secondary="week_meals", back_populates="meals", viewonly=True)


class WeekPlan(Base):
    __tablename__ = "week_plans"

    id = Column(Integer, primary_key=True, index=True)
    start_date = Column(Date, unique=True, index=True)
    end_date = Column(Date)

    days = relationship("Day", back_populates="week_plan", cascade="all, delete-orphan")
    # Read-only views; writes go through WeekMeal rows (see crud).
    meals = relationship("Meal", secondary="week_meals", back_populates="week_plans", viewonly=True)
    meal_servings = relationship("WeekMeal", viewonly=True, order_by="WeekMeal.id")


class Day(Base):
    __tablename__ = "days"

    id = Column(Integer, primary_key=True, index=True)
    week_plan_id = Column(Integer, ForeignKey("week_plans.id"))
    date = Column(Date)
    day_name = Column(String)
    state = Column(String, default="need")  # "need" or "none"

    week_plan = relationship("WeekPlan", back_populates="days")


class PairingIngredient(Base):
    __tablename__ = "pairing_ingredients"

    id = Column(Integer, primary_key=True)
    week_plan_id = Column(Integer, ForeignKey("week_plans.id"), nullable=False, index=True)
    meal_id = Column(Integer, ForeignKey("meals.id"), nullable=True)
    amount = Column(String, nullable=False)


class InventoryItem(Base):
    """Running fridge/pantry stock. Global: deliberately has no week foreign key."""
    __tablename__ = "inventory_items"
    __table_args__ = (UniqueConstraint("item", "unit_group", "location"),)

    id = Column(Integer, primary_key=True)
    item = Column(String, nullable=False)
    unit_group = Column(String, nullable=False)
    unit = Column(String, nullable=False)  # display unit from the first credit
    location = Column(String, nullable=False)  # "fridge" or "pantry"
    base_quantity = Column(Float, nullable=False, default=0.0)


class InventoryPurchase(Base):
    """One credited purchase. purchase_id is single-use, which makes crediting idempotent."""
    __tablename__ = "inventory_purchases"

    id = Column(Integer, primary_key=True)
    purchase_id = Column(String, unique=True, nullable=False, index=True)
    inventory_item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    amount = Column(String, nullable=False)
    base_quantity = Column(Float, nullable=False)
    reverted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    inventory_item = relationship("InventoryItem")
