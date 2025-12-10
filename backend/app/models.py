from sqlalchemy import Column, Integer, String, Date, ForeignKey, Table
from sqlalchemy.orm import relationship
from .database import Base


# Association table for many-to-many relationship between Day and Meal
day_meal_association = Table(
    'day_meals',
    Base.metadata,
    Column('id', Integer, primary_key=True),
    Column('day_id', Integer, ForeignKey('days.id')),
    Column('meal_id', Integer, ForeignKey('meals.id'))
)


class Meal(Base):
    __tablename__ = "meals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    notes = Column(String, nullable=True)
    tags = Column(String, nullable=True)
    ingredients = Column(String, nullable=True)

    days = relationship("Day", secondary=day_meal_association, back_populates="meals")


class WeekPlan(Base):
    __tablename__ = "week_plans"

    id = Column(Integer, primary_key=True, index=True)
    start_date = Column(Date, unique=True, index=True)
    end_date = Column(Date)

    days = relationship("Day", back_populates="week_plan", cascade="all, delete-orphan")


class Day(Base):
    __tablename__ = "days"

    id = Column(Integer, primary_key=True, index=True)
    week_plan_id = Column(Integer, ForeignKey("week_plans.id"))
    date = Column(Date)
    day_name = Column(String)
    state = Column(String, default="neutral")  # "need", "none", "neutral"

    week_plan = relationship("WeekPlan", back_populates="days")
    meals = relationship("Meal", secondary=day_meal_association, back_populates="days")
