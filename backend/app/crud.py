from sqlalchemy.orm import Session
from datetime import date, timedelta
from . import models, schemas


def get_meals(db: Session, search: str = None):
    query = db.query(models.Meal)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (models.Meal.name.ilike(search_term)) |
            (models.Meal.notes.ilike(search_term)) |
            (models.Meal.tags.ilike(search_term)) |
            (models.Meal.ingredients.ilike(search_term))
        )
    return query.all()


def create_meal(db: Session, meal: schemas.MealCreate):
    db_meal = models.Meal(**meal.model_dump())
    db.add(db_meal)
    db.commit()
    db.refresh(db_meal)
    return db_meal


def get_current_week_plan(db: Session):
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())

    week_plan = db.query(models.WeekPlan).filter(
        models.WeekPlan.start_date == start_of_week
    ).first()

    if not week_plan:
        week_plan = create_week_plan(db, start_of_week)

    return week_plan


def create_week_plan(db: Session, start_date: date):
    end_date = start_date + timedelta(days=6)
    week_plan = models.WeekPlan(start_date=start_date, end_date=end_date)
    db.add(week_plan)
    db.commit()
    db.refresh(week_plan)

    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    for i in range(7):
        day = models.Day(
            week_plan_id=week_plan.id,
            date=start_date + timedelta(days=i),
            day_name=day_names[i],
            state="neutral"
        )
        db.add(day)

    db.commit()
    db.refresh(week_plan)
    return week_plan


def update_day_state(db: Session, day_id: int, day_update: schemas.DayUpdate):
    day = db.query(models.Day).filter(models.Day.id == day_id).first()
    if day and day_update.state:
        day.state = day_update.state
        db.commit()
        db.refresh(day)
    return day


def add_meal_to_day(db: Session, day_id: int, meal_id: int):
    day = db.query(models.Day).filter(models.Day.id == day_id).first()
    meal = db.query(models.Meal).filter(models.Meal.id == meal_id).first()

    if day and meal:
        day.meals.append(meal)
        db.commit()
        db.refresh(day)
    return day


def remove_meal_from_day(db: Session, day_id: int, meal_id: int):
    day = db.query(models.Day).filter(models.Day.id == day_id).first()
    meal = db.query(models.Meal).filter(models.Meal.id == meal_id).first()

    if day and meal and meal in day.meals:
        day.meals.remove(meal)
        db.commit()
        db.refresh(day)
    return day
