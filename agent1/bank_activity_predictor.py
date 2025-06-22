"""
Bank Activity Predictor Module
Provides realistic bank activity schedules based on time of day and other factors.
"""

import random
from datetime import datetime, timedelta
from typing import List, Dict
from pydantic import BaseModel

class BankActivityHour(BaseModel):
    hour: int
    isActive: bool

def get_daily_activity_schedule(day_offset: int = 0) -> List[BankActivityHour]:
    """
    Generate a daily activity schedule for banks.
    
    Args:
        day_offset: Number of days offset from today (0 = today, 1 = tomorrow, -1 = yesterday)
    
    Returns:
        List of BankActivityHour objects representing 24-hour schedule
    """
    
    # Get the target date
    target_date = datetime.now() + timedelta(days=day_offset)
    current_hour = datetime.now().hour
    
    # Define base banking activity patterns
    # This represents the probability of a bank being active at each hour
    base_activity_pattern = {
        0: 0.05,   # 12 AM - 1 AM (very low, ATM/online only)
        1: 0.02,   # 1 AM - 2 AM (minimal)
        2: 0.02,   # 2 AM - 3 AM (minimal)
        3: 0.02,   # 3 AM - 4 AM (minimal)
        4: 0.02,   # 4 AM - 5 AM (minimal)
        5: 0.05,   # 5 AM - 6 AM (very low)
        6: 0.3,    # 6 AM - 7 AM (early transactions)
        7: 0.6,    # 7 AM - 8 AM (morning prep)
        8: 0.8,    # 8 AM - 9 AM (opening hours)
        9: 0.95,   # 9 AM - 10 AM (peak business hours)
        10: 0.95,  # 10 AM - 11 AM (peak business hours)
        11: 0.95,  # 11 AM - 12 PM (peak business hours)
        12: 0.9,   # 12 PM - 1 PM (lunch time, slightly lower)
        13: 0.95,  # 1 PM - 2 PM (peak business hours)
        14: 0.95,  # 2 PM - 3 PM (peak business hours)
        15: 0.95,  # 3 PM - 4 PM (peak business hours)
        16: 0.9,   # 4 PM - 5 PM (end of business day)
        17: 0.7,   # 5 PM - 6 PM (closing operations)
        18: 0.4,   # 6 PM - 7 PM (limited services)
        19: 0.2,   # 7 PM - 8 PM (minimal)
        20: 0.1,   # 8 PM - 9 PM (very low)
        21: 0.1,   # 9 PM - 10 PM (very low)
        22: 0.05,  # 10 PM - 11 PM (very low)
        23: 0.05,  # 11 PM - 12 AM (very low)
    }
    
    # Modify pattern based on day of week
    weekday = target_date.weekday()  # 0 = Monday, 6 = Sunday
    
    if weekday >= 5:  # Weekend (Saturday = 5, Sunday = 6)
        # Reduce activity on weekends
        weekend_modifier = 0.3
        for hour in base_activity_pattern:
            base_activity_pattern[hour] *= weekend_modifier
    
    # Generate schedule
    schedule = []
    
    for hour in range(24):
        probability = base_activity_pattern[hour]
        
        # Add some randomness for realism
        random_factor = random.uniform(0.8, 1.2)
        final_probability = min(1.0, probability * random_factor)
        
        # Special case: if it's the current hour, add some bias toward activity
        if day_offset == 0 and hour == current_hour:
            final_probability = min(1.0, final_probability * 1.5)
        
        # Determine if active based on probability
        is_active = random.random() < final_probability
        
        schedule.append(BankActivityHour(hour=hour, isActive=is_active))
    
    return schedule

def get_bank_status_summary(schedule: List[BankActivityHour]) -> Dict:
    """
    Get a summary of the bank activity schedule.
    
    Args:
        schedule: List of BankActivityHour objects
    
    Returns:
        Dictionary with summary statistics
    """
    active_hours = sum(1 for hour in schedule if hour.isActive)
    total_hours = len(schedule)
    
    # Find peak activity periods
    peak_hours = []
    for hour in schedule:
        if hour.isActive and 9 <= hour.hour <= 17:  # Business hours
            peak_hours.append(hour.hour)
    
    return {
        "total_active_hours": active_hours,
        "total_hours": total_hours,
        "activity_percentage": (active_hours / total_hours) * 100,
        "peak_business_hours": peak_hours,
        "is_weekend": datetime.now().weekday() >= 5,
        "current_hour": datetime.now().hour,
        "currently_active": any(h.isActive for h in schedule if h.hour == datetime.now().hour)
    }

def get_real_time_activity_status() -> Dict:
    """
    Get real-time activity status for the current hour.
    
    Returns:
        Dictionary with current activity information
    """
    current_schedule = get_daily_activity_schedule(day_offset=0)
    current_hour = datetime.now().hour
    
    current_hour_activity = next(
        (hour for hour in current_schedule if hour.hour == current_hour), 
        None
    )
    
    return {
        "current_time": datetime.now().isoformat(),
        "current_hour": current_hour,
        "is_active": current_hour_activity.isActive if current_hour_activity else False,
        "next_hour_forecast": current_schedule[current_hour + 1].isActive if current_hour < 23 else current_schedule[0].isActive,
        "schedule_summary": get_bank_status_summary(current_schedule)
    }

# Example usage and testing
if __name__ == "__main__":
    print("Bank Activity Predictor - Test Run")
    print("=" * 50)
    
    # Get today's schedule
    today_schedule = get_daily_activity_schedule(0)
    
    print(f"Today's Schedule ({datetime.now().strftime('%Y-%m-%d')}):")
    for hour in today_schedule:
        status = "ACTIVE" if hour.isActive else "INACTIVE"
        print(f"  {hour.hour:2d}:00 - {status}")
    
    print("\nSummary:")
    summary = get_bank_status_summary(today_schedule)
    for key, value in summary.items():
        print(f"  {key}: {value}")
    
    print("\nReal-time Status:")
    real_time = get_real_time_activity_status()
    for key, value in real_time.items():
        if key != "schedule_summary":
            print(f"  {key}: {value}")