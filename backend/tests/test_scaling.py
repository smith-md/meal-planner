"""Pure-function tests for ingredient parsing and scaling (AC2, AC3, AC4)."""
from types import SimpleNamespace

import pytest

from app import crud
from app.main import parse_yield
from app.pairings import meal_amounts, meal_lines, parse_amount, scale_factor


def meal(ingredients, yield_servings=None):
    return SimpleNamespace(ingredients=ingredients, yield_servings=yield_servings)


# T7 (AC3): fractions, unicode fractions, scaled display
def test_parse_amount_handles_fractions():
    assert parse_amount("1 1/2 cups milk").quantity == 1.5
    assert parse_amount("1½ cups milk").quantity == 1.5
    assert parse_amount("3/4 tsp salt").quantity == 0.75


def test_scaled_fraction_display():
    factor = scale_factor(3, 2)
    assert factor == 1.5
    milk = parse_amount("1 1/2 cups milk")
    salt = parse_amount("3/4 tsp salt")
    assert milk.display_quantity(milk.base_quantity * factor) == "2 1/4"
    assert salt.display_quantity(salt.base_quantity * factor) == "1 1/8"


# R1 / R3 (AC2, AC3): factor rules
def test_scale_factor_rules():
    assert scale_factor(6, 4) == 1.5
    assert scale_factor(None, 4) == 1.0
    assert scale_factor(6, None) == 1.0
    assert scale_factor(6, 0) == 1.0
    assert scale_factor(0, 4) == 1.0


# AC2: meal_amounts scales base quantities
def test_meal_amounts_scaled_by_servings_over_yield():
    totals = meal_amounts(meal("1/2 cup rice", yield_servings=4), servings=6)
    assert totals[("rice", "volume")] == 0.75


# T9 (AC3): missing yield means unscaled
def test_missing_yield_is_unscaled():
    totals = meal_amounts(meal("2 cups rice", yield_servings=None), servings=6)
    assert totals[("rice", "volume")] == 2.0


# T10 (AC3): ambiguous text is not parsed or scaled
def test_ambiguous_lines_are_unmeasured():
    lines = "salt to taste\n2-3 cloves garlic\n1 (14 oz) can tomatoes"
    _, first, unmeasured, factor = meal_lines(meal(lines, yield_servings=2), servings=4)
    assert first == {}
    assert unmeasured == ["salt to taste", "2-3 cloves garlic", "1 (14 oz) can tomatoes"]
    assert factor == 2.0


# AC3: exact metric conversions
def test_metric_conversions_are_consistent():
    grams = parse_amount("500 g flour")
    kilos = parse_amount("1 kg flour")
    assert grams.key == kilos.key
    total = grams.base_quantity + kilos.base_quantity
    assert grams.display_quantity(total) == "1500"
    liters = parse_amount("1 l broth")
    ml = parse_amount("500 ml broth")
    # 1 l + 500 ml displays in the first line's unit (liters)
    assert liters.display_quantity(liters.base_quantity + ml.base_quantity) == "1 1/2"
    assert crud.UNIT_CONVERSIONS["kg"] / crud.UNIT_CONVERSIONS["g"] == pytest.approx(1000)


# T11 (AC4): unit groups stay separate
def test_unit_groups_are_separate_keys():
    keys = {
        parse_amount(line).key
        for line in (
            "1 cup flour", "4 oz flour", "2 chicken breasts", "1 lb chicken breasts",
            "3 cloves garlic", "2 garlic",
        )
    }
    assert keys == {
        ("flour", "volume"), ("flour", "weight"),
        ("chicken breasts", "count"), ("chicken breasts", "weight"),
        ("garlic", "clove"), ("garlic", "count"),
    }


def test_volume_units_combine():
    assert parse_amount("1 cup broth").key == parse_amount("8 tbsp broth").key


# O1: recipeYield parsing
def test_parse_yield():
    assert parse_yield(4) == 4
    assert parse_yield("4 servings") == 4
    assert parse_yield(["6", "6 servings"]) == 6
    assert parse_yield("Makes lots") is None
    assert parse_yield(None) is None
    assert parse_yield(0) is None
    assert parse_yield(500) is None
    assert parse_yield(True) is None
    assert parse_yield([]) is None
