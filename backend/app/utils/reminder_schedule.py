"""
Utility functions for handling reminder schedules
Supports predefined schedules (gentle, normal, frequent) and custom schedules
"""

from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta


class ReminderSchedule:
    """Handles reminder schedule calculations and configurations"""
    
    # Predefined schedules: days before due date
    PREDEFINED_SCHEDULES = {
        'gentle': [3, 1],
        'normal': [5, 3, 1],
        'frequent': [14, 7, 6, 5, 4, 3, 2, 1]
    }
    
    @staticmethod
    def get_reminder_days(schedule_type: str, custom_days: Optional[List[int]] = None) -> List[int]:
        """
        Get the list of days before due date for reminders
        
        Args:
            schedule_type: 'gentle', 'normal', 'frequent', or 'custom'
            custom_days: List of days before due date (only used if schedule_type is 'custom')
        
        Returns:
            List of days before due date, sorted in descending order
        """
        if schedule_type == 'custom' and custom_days:
            # Validate and sort custom days
            days = [d for d in custom_days if isinstance(d, int) and d > 0]
            return sorted(set(days), reverse=True)
        elif schedule_type in ReminderSchedule.PREDEFINED_SCHEDULES:
            return ReminderSchedule.PREDEFINED_SCHEDULES[schedule_type]
        else:
            # Default to normal if invalid type
            return ReminderSchedule.PREDEFINED_SCHEDULES['normal']
    
    @staticmethod
    def calculate_reminder_dates(due_date: datetime, reminder_days: List[int]) -> List[datetime]:
        """
        Calculate the actual dates when reminders should be sent
        
        Args:
            due_date: The due date for the form
            reminder_days: List of days before due date
        
        Returns:
            List of datetime objects for when reminders should be sent, sorted chronologically
        """
        reminder_dates = []
        for days_before in reminder_days:
            reminder_date = due_date - timedelta(days=days_before)
            # Only include future dates
            if reminder_date > datetime.utcnow():
                reminder_dates.append(reminder_date)
        
        return sorted(reminder_dates)
    
    @staticmethod
    def get_schedule_config(schedule_type: str, custom_days: Optional[List[int]] = None) -> Dict:
        """
        Get the full schedule configuration
        
        Args:
            schedule_type: 'gentle', 'normal', 'frequent', or 'custom'
            custom_days: List of days before due date (only used if schedule_type is 'custom')
        
        Returns:
            Dictionary with schedule configuration
        """
        reminder_days = ReminderSchedule.get_reminder_days(schedule_type, custom_days)
        
        return {
            'schedule_type': schedule_type,
            'reminder_days': reminder_days,
            'is_custom': schedule_type == 'custom',
            'custom_days': custom_days if schedule_type == 'custom' else None
        }
    
    @staticmethod
    def validate_custom_schedule(custom_days: List[int]) -> Tuple[bool, Optional[str]]:
        """
        Validate a custom schedule
        
        Args:
            custom_days: List of days before due date
        
        Returns:
            Tuple of (is_valid, error_message)
        """
        if not custom_days:
            return False, "Custom schedule must have at least one day"
        
        if not all(isinstance(d, int) for d in custom_days):
            return False, "All days must be integers"
        
        if not all(d > 0 for d in custom_days):
            return False, "All days must be positive numbers"
        
        if max(custom_days) > 365:
            return False, "Days cannot exceed 365"
        
        if len(custom_days) > 30:
            return False, "Cannot have more than 30 reminder days"
        
        return True, None

