from datetime import date as dt_date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import schemas, models, crud
from ..deps import get_db

router = APIRouter(prefix="/week-plans", tags=["week-plans"])


@router.get("/current", response_model=schemas.WeekPlanRead)
def get_current_week_plan(
    db: Session = Depends(get_db),
    ref_date: Optional[dt_date] = Query(None),
):
    wp = crud.get_current_week_plan(db, ref_date=ref_date)
    if not wp:
        raise HTTPException(status_code=404, detail="Week plan not found")

    # Eager load relationships
    for d in wp.days:
        _ = d.meals

    summary = crud.compute_weekplan_summary(wp)
    wp_dict = {
        "id": wp.id,
        "start_date": wp.start_date,
        "name": wp.name,
        "is_active": wp.is_active,
        "days": wp.days,
        "summary": summary,
    }
    return wp_dict


@router.patch("/days/{day_id}", response_model=schemas.WeekPlanRead)
def update_week_day(
    day_id: int,
    update: schemas.WeekDayUpdate,
    db: Session = Depends(get_db),
):
    day = db.query(models.WeekDay).filter(models.WeekDay.id == day_id).first()
    if not day:
        raise HTTPException(status_code=404, detail="Week day not found")

    if update.need_meal is not None:
        day.need_meal = update.need_meal
    if update.notes is not None:
        day.notes = update.notes

    db.commit()
    db.refresh(day)

    wp = day.week_plan
    for d in wp.days:
        _ = d.meals
    summary = crud.compute_weekplan_summary(wp)
    wp_dict = {
        "id": wp.id,
        "start_date": wp.start_date,
        "name": wp.name,
        "is_active": wp.is_active,
        "days": wp.days,
        "summary": summary,
    }
    return wp_dict


@router.post("/days/{day_id}/meals", response_model=schemas.WeekPlanRead)
def add_meal_to_day(
    day_id: int,
    payload: schemas.WeekDayMealCreate,
    db: Session = Depends(get_db),
):
    day = db.query(models.WeekDay).filter(models.WeekDay.id == day_id).first()
    if not day:
        raise HTTPException(status_code=404, detail="Week day not found")

    meal = db.query(models.Meal).filter(models.Meal.id == payload.meal_id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")

    db_wdm = models.WeekDayMeal(
        week_day_id=day.id,
        meal_id=meal.id,
        servings=payload.servings or meal.default_servings,
    )
    db.add(db_wdm)
    db.commit()
    db.refresh(day)

    wp = day.week_plan
    for d in wp.days:
        _ = d.meals
    summary = crud.compute_weekplan_summary(wp)
    wp_dict = {
        "id": wp.id,
        "start_date": wp.start_date,
        "name": wp.name,
        "is_active": wp.is_active,
        "days": wp.days,
        "summary": summary,
    }
    return wp_dict


@router.delete("/day-meals/{day_meal_id}", response_model=schemas.WeekPlanRead)
def remove_meal_from_day(
    day_meal_id: int,
    db: Session = Depends(get_db),
):
    wdm = (
        db.query(models.WeekDayMeal)
        .filter(models.WeekDayMeal.id == day_meal_id)
        .first()
    )
    if not wdm:
        raise HTTPException(status_code=404, detail="WeekDayMeal not found")

    day = wdm.week_day
    wp = day.week_plan

    db.delete(wdm)
    db.commit()

    # reload
    db.refresh(day)
    db.refresh(wp)
    for d in wp.days:
        _ = d.meals

    summary = crud.compute_weekplan_summary(wp)
    wp_dict = {
        "id": wp.id,
        "start_date": wp.start_date,
        "name": wp.name,
        "is_active": wp.is_active,
        "days": wp.days,
        "summary": summary,
    }
    return wp_dict
