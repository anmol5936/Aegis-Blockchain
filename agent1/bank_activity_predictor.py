import datetime

def get_bank_activity(current_time: datetime.datetime) -> dict:
    """
    Determines if the bank is active based on the current time.
    For this dummy implementation:
    - Bank is active from 9 AM to 5 PM (17:00) on weekdays.
    - Bank is inactive on weekends.
    Returns a dictionary with activity status and active hours for the day.
    """
    weekday = current_time.weekday()  # Monday is 0 and Sunday is 6
    hour = current_time.hour

    is_weekday = weekday < 5  # Monday to Friday
    is_active_hours = 9 <= hour < 17

    active_today = is_weekday and is_active_hours

    # Define typical active hours for visualization
    # For simplicity, let's assume the same active hours for all weekdays
    # and no active hours for weekends.
    daily_schedule = []
    if is_weekday:
        for h in range(24):
            if 9 <= h < 17:
                daily_schedule.append({"hour": h, "isActive": True})
            else:
                daily_schedule.append({"hour": h, "isActive": False})
    else: # Weekend
        for h in range(24):
            daily_schedule.append({"hour": h, "isActive": False})

    return {
        "currentTime": current_time.isoformat(),
        "isActiveNow": active_today,
        "dailySchedule": daily_schedule # Provides a full 24h schedule
    }

def get_daily_activity_schedule(day_offset: int = 0) -> list[dict]:
    """
    Returns the bank's activity schedule for a given day (offset from today).
    Each item in the list represents an hour of the day and its activity status.
    """
    target_day = datetime.datetime.now() + datetime.timedelta(days=day_offset)
    schedule = []
    weekday = target_day.weekday()
    is_weekday = weekday < 5

    for hour_of_day in range(24):
        is_active_hour = False
        if is_weekday and 9 <= hour_of_day < 17:
            is_active_hour = True
        schedule.append({"hour": hour_of_day, "isActive": is_active_hour})
    return schedule

if __name__ == '__main__':
    # Example usage:
    now = datetime.datetime.now()
    activity_info = get_bank_activity(now)
    print(f"Current bank activity: {activity_info['isActiveNow']}")
    print(f"Activity for hour 10: {activity_info['dailySchedule'][10]['isActive']}")
    print(f"Activity for hour 18: {activity_info['dailySchedule'][18]['isActive']}")

    today_schedule = get_daily_activity_schedule()
    print("\nToday's hourly schedule:")
    for hour_info in today_schedule:
        print(f"Hour {hour_info['hour']}: {'Active' if hour_info['isActive'] else 'Inactive'}")

    tomorrow = datetime.datetime.now() + datetime.timedelta(days=1)
    activity_info_tomorrow = get_bank_activity(tomorrow)
    print(f"\nTomorrow's bank activity at this time: {activity_info_tomorrow['isActiveNow']}")

    # Test weekend
    saturday = now
    while saturday.weekday() != 5: # Find next Saturday
        saturday += datetime.timedelta(days=1)
    saturday_activity = get_bank_activity(saturday.replace(hour=10)) # Saturday 10 AM
    print(f"\nSaturday 10 AM activity: {saturday_activity['isActiveNow']}")
    print(f"Saturday schedule: {saturday_activity['dailySchedule']}")

    activity_saturday_schedule = get_daily_activity_schedule(day_offset=(saturday - now).days)
    print("\nSaturday's hourly schedule (using get_daily_activity_schedule):")
    for hour_info in activity_saturday_schedule:
        print(f"Hour {hour_info['hour']}: {'Active' if hour_info['isActive'] else 'Inactive'}")
