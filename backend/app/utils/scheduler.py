"""
Automatic Reminder Scheduler
============================

This module provides automatic reminder scheduling using APScheduler.
It periodically checks all active form requests and sends reminder emails
to non-responders when the current date matches a scheduled reminder day.

Key Components:
--------------
- TEST_MODE: Toggle for development vs production scheduling intervals
- check_and_send_reminders(): The main job that runs on a schedule
- init_scheduler(): Initializes and starts the background scheduler

Usage:
------
In app.py:
    from utils.scheduler import init_scheduler
    reminder_scheduler = init_scheduler(app)

Test Mode:
----------
Set SCHEDULER_TEST_MODE=true in .env to run checks every minute instead of hourly.
"""

import os
from datetime import datetime, timezone
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger


# ============================================================================
# CONFIGURATION
# ============================================================================

# TEST_MODE: When True, the scheduler checks every 1 minute (for development/testing)
#            When False, the scheduler checks every 60 minutes (for production)
# 
# To enable test mode, either:
#   1. Set environment variable: SCHEDULER_TEST_MODE=true
#   2. Or change this line to: TEST_MODE = True
TEST_MODE = False  # <-- FLIP THIS TO False FOR PRODUCTION

# Override with environment variable if set
if os.environ.get('SCHEDULER_TEST_MODE', '').lower() == 'false':
    TEST_MODE = False
elif os.environ.get('SCHEDULER_TEST_MODE', '').lower() == 'true':
    TEST_MODE = True

# Calculate check interval based on mode
# Test mode: 1 minute | Production mode: 60 minutes (1 hour)
CHECK_INTERVAL_MINUTES = 1 if TEST_MODE else 60


def fix_corrupted_date(date_str: str) -> str:
    """
    Fix corrupted date strings that have duplicate timezone suffixes.
    
    Example:
        '2026-02-02T22:57:46.179000+00:00+00:00' -> '2026-02-02T22:57:46.179000+00:00'
    """
    if not isinstance(date_str, str):
        return date_str
    
    # Check for duplicate +00:00 (common corruption pattern)
    if date_str.endswith('+00:00+00:00'):
        return date_str[:-6]  # Remove the last +00:00
    
    # Check for duplicate Z
    if date_str.endswith('ZZ'):
        return date_str[:-1]
    
    # Check for +00:00Z or Z+00:00
    if date_str.endswith('+00:00Z'):
        return date_str[:-1]
    if date_str.endswith('Z+00:00'):
        return date_str[:-6]
    
    return date_str


# ============================================================================
# MAIN SCHEDULER JOB
# ============================================================================

def check_and_send_reminders():
    """
    Main scheduler job: Checks all active form requests and sends reminders.
    
    This function runs periodically (every 1 minute in test mode, every hour in production).
    
    How it works:
    1. Fetches all form requests from the database
    2. For each request with a due date:
       a. Skips if already past due
       b. Calculates how many days until the due date
       c. Checks if today is a scheduled reminder day (e.g., 7 days before, 3 days before)
       d. If yes, sends reminder emails to all group members who haven't responded
    
    The reminder schedule is configured per form request:
    - 'gentle': [3, 1] days before
    - 'normal': [5, 3, 1] days before  
    - 'frequent': [14, 7, 6, 5, 4, 3, 2, 1] days before
    - 'custom': User-defined days
    """
    # Import inside function to avoid circular imports
    from models.database import get_db, Collections
    from models.group import Group
    from models.org_membership import OrgMembership
    from utils.email_service import EmailService
    from utils.reminder_schedule import ReminderSchedule
    
    print(f"\n{'='*60}")
    print(f"🔔 [{datetime.now()}] Running automatic reminder check...")
    print(f"   Mode: {'TEST (every minute)' if TEST_MODE else 'PRODUCTION (every hour)'}")
    print(f"{'='*60}")
    
    try:
        db = get_db()
        
        # ----------------------------------------------------------------
        # Step 1: Get all form requests from the database
        # ----------------------------------------------------------------
        requests = db.collection(Collections.FORM_REQUESTS).stream()
        
        # Get current date in UTC for comparison
        now = datetime.now(timezone.utc)
        today = now.date()
        
        requests_checked = 0
        reminders_sent_total = 0
        
        # ----------------------------------------------------------------
        # Step 2: Process each form request
        # ----------------------------------------------------------------
        for req_doc in requests:
            req_data = req_doc.to_dict()
            request_id = req_doc.id
            requests_checked += 1
            
            # Get the due date - skip if not set
            due_date_str = req_data.get('due_date')
            if not due_date_str:
                continue
            
            # Parse the due date string into a datetime object
            try:
                if isinstance(due_date_str, str):
                    # Fix corrupted dates first (duplicate timezone suffixes)
                    due_date_str = fix_corrupted_date(due_date_str)
                    # Handle ISO format with or without timezone
                    due_date = datetime.fromisoformat(due_date_str.replace('Z', '+00:00'))
                else:
                    due_date = due_date_str
                    
                # Ensure timezone awareness
                if due_date.tzinfo is None:
                    due_date = due_date.replace(tzinfo=timezone.utc)
            except Exception as e:
                print(f"  ⚠️ Could not parse due_date for request {request_id}: {e}")
                continue
            
            # Skip if already past due
            if due_date.date() < today:
                continue
            
            # ----------------------------------------------------------------
            # Step 3: Determine the reminder schedule for this request
            # ----------------------------------------------------------------
            # The schedule is stored in the reminder_schedule field
            reminder_config = req_data.get('reminder_schedule', {})
            
            if isinstance(reminder_config, dict):
                schedule_type = reminder_config.get('schedule_type', 'normal')
                custom_days = reminder_config.get('custom_days')
            else:
                # Legacy format: reminder_schedule was just a string
                schedule_type = reminder_config if isinstance(reminder_config, str) else 'normal'
                custom_days = None
            
            # Get the list of days before due date when reminders should be sent
            reminder_days = ReminderSchedule.get_reminder_days(schedule_type, custom_days)
            
            # ----------------------------------------------------------------
            # Step 4: Check if today is a reminder day
            # ----------------------------------------------------------------
            days_until_due = (due_date.date() - today).days
            
            # In TEST_MODE, skip the day check and always send
            # In production, only send on scheduled reminder days
            if not TEST_MODE:
                if days_until_due not in reminder_days:
                    # Today is not a scheduled reminder day for this request
                    continue
            
            form_title = req_data.get('title', 'Untitled Form')
            print(f"\n  📧 Request '{form_title}' (ID: {request_id})")
            if TEST_MODE:
                print(f"     Due in {days_until_due} days - TEST MODE, sending anyway!")
            else:
                print(f"     Due in {days_until_due} days - TODAY IS A REMINDER DAY!")
            
            # ----------------------------------------------------------------
            # Step 5: Get the group and find non-responders
            # ----------------------------------------------------------------
            group_id = req_data.get('group_id')
            if not group_id:
                print(f"     ⚠️ No group attached, skipping")
                continue
            
            group = Group.get_by_id(group_id)
            if not group:
                print(f"     ⚠️ Group not found, skipping")
                continue
            
            # Get all responses for this form request
            responses = db.collection(Collections.RESPONSES)\
                .where('request_id', '==', request_id)\
                .stream()
            
            # Build a set of emails that have already responded (case-insensitive)
            responded_emails = set()
            for resp in responses:
                resp_data = resp.to_dict()
                email_lower = resp_data.get('respondent_email', '').lower()
                if email_lower:
                    responded_emails.add(email_lower)
            
            print(f"     Group: {group.name} ({len(group.members)} members)")
            print(f"     Already responded: {len(responded_emails)}")
            
            # ----------------------------------------------------------------
            # Step 6: Send reminders to non-responders
            # ----------------------------------------------------------------
            owner_id = req_data.get('owner_id')
            form_url = req_data.get('form_url')
            
            # If form_url not in request, try to get from forms collection
            if not form_url:
                form_id = req_data.get('form_id')
                if form_id:
                    form_doc = db.collection(Collections.FORMS).document(form_id).get()
                    if form_doc.exists:
                        form_url = form_doc.to_dict().get('form_url')
            
            sent_count = 0
            skipped_responded = 0
            skipped_opted_out = 0
            skipped_rate_limit = 0
            failed = 0
            
            for member in group.members:
                member_email = member['email']
                
                # Skip if already responded
                if member_email.lower() in responded_emails:
                    skipped_responded += 1
                    continue
                
                # Skip if opted out at organization level
                if owner_id and OrgMembership.is_opted_out(owner_id, member_email):
                    skipped_opted_out += 1
                    continue
                
                # Send the reminder email
                # In TEST_MODE, skip rate limiting so we can test emails quickly
                result = EmailService.send_reminder(
                    request_id,
                    form_title,
                    form_url,
                    member_email,
                    owner_id=owner_id,
                    skip_rate_limit=TEST_MODE  # Bypass rate limit in test mode
                )
                
                if result.get('success'):
                    sent_count += 1
                elif 'Rate limit' in result.get('error', ''):
                    skipped_rate_limit += 1
                elif result.get('opted_out'):
                    skipped_opted_out += 1
                else:
                    failed += 1
                    print(f"     ❌ Failed to send to {member_email}: {result.get('error')}")
            
            # Log summary for this request
            print(f"     ✅ Sent: {sent_count}")
            if skipped_responded:
                print(f"     ⏭️ Already responded: {skipped_responded}")
            if skipped_opted_out:
                print(f"     🚫 Opted out: {skipped_opted_out}")
            if skipped_rate_limit:
                print(f"     ⏳ Rate limited: {skipped_rate_limit}")
            if failed:
                print(f"     ❌ Failed: {failed}")
            
            reminders_sent_total += sent_count
        
        # ----------------------------------------------------------------
        # Step 7: Log completion summary
        # ----------------------------------------------------------------
        print(f"\n{'='*60}")
        print(f"🔔 Reminder check complete!")
        print(f"   Requests checked: {requests_checked}")
        print(f"   Total reminders sent: {reminders_sent_total}")
        print(f"{'='*60}\n")
        
    except Exception as e:
        print(f"\n❌ Error in reminder scheduler: {e}")
        import traceback
        traceback.print_exc()


# ============================================================================
# OVERDUE FORM CHECK
# ============================================================================

def check_overdue_forms():
    """
    Check for forms that have just become overdue and notify owners.
    
    A form is considered overdue if:
    - The due date has passed (due_date < today)
    - The form is not fully completed (response_count < total_recipients)
    - We haven't already sent an overdue notification for this form
    """
    from models.database import get_db, Collections
    from models.group import Group
    from models.notification import notify_form_overdue, Notification
    
    print(f"\n{'='*60}")
    print(f"⏰ [{datetime.now()}] Checking for overdue forms...")
    print(f"{'='*60}")
    
    try:
        db = get_db()
        now = datetime.now(timezone.utc)
        today = now.date()
        
        requests = db.collection(Collections.FORM_REQUESTS).stream()
        overdue_count = 0
        
        for req_doc in requests:
            req_data = req_doc.to_dict()
            request_id = req_doc.id
            
            due_date_str = req_data.get('due_date')
            if not due_date_str:
                continue
            
            # Parse due date
            try:
                if isinstance(due_date_str, str):
                    due_date_str = fix_corrupted_date(due_date_str)
                    due_date = datetime.fromisoformat(due_date_str.replace('Z', '+00:00'))
                else:
                    due_date = due_date_str
                    
                if due_date.tzinfo is None:
                    due_date = due_date.replace(tzinfo=timezone.utc)
            except Exception:
                continue
            
            # Check if just became overdue (due date was yesterday or earlier)
            if due_date.date() >= today:
                continue  # Not overdue yet
            
            # Check if we already sent an overdue notification for this form
            existing_notifications = db.collection(Collections.NOTIFICATIONS)\
                .where('form_reminder_id', '==', request_id)\
                .where('type', '==', 'form_overdue')\
                .limit(1)\
                .stream()
            
            already_notified = False
            for _ in existing_notifications:
                already_notified = True
                break
            
            if already_notified:
                continue
            
            # Check if form was completed (response_count >= total_recipients)
            group_id = req_data.get('group_id')
            if not group_id:
                continue
                
            group = Group.get_by_id(group_id)
            if not group:
                continue
                
            total_recipients = len(group.members)
            
            # Count responses
            responses = db.collection(Collections.RESPONSES)\
                .where('request_id', '==', request_id)\
                .stream()
            response_count = sum(1 for _ in responses)
            
            # If completed, no need to notify about overdue
            if response_count >= total_recipients:
                continue
            
            # Send overdue notification
            owner_id = req_data.get('owner_id')
            form_title = req_data.get('title', 'Untitled Form')
            
            notify_form_overdue(
                user_id=owner_id,
                form_name=form_title,
                form_reminder_id=request_id
            )
            
            print(f"   ⏰ Form '{form_title}' is overdue! ({response_count}/{total_recipients} responses)")
            overdue_count += 1
        
        print(f"\n   Found {overdue_count} newly overdue form(s)")
        print(f"{'='*60}\n")
        
    except Exception as e:
        print(f"\n❌ Error checking overdue forms: {e}")
        import traceback
        traceback.print_exc()


# ============================================================================
# SCHEDULER INITIALIZATION
# ============================================================================

def init_scheduler(app):
    """
    Initialize and start the APScheduler background scheduler.
    
    This creates a BackgroundScheduler that runs in a separate thread,
    allowing the Flask app to continue handling requests while the
    scheduler periodically checks for reminders to send.
    
    Args:
        app: The Flask application instance (for context if needed)
    
    Returns:
        The scheduler instance (can be used to stop/modify the scheduler later)
    
    Usage:
        In app.py:
        reminder_scheduler = init_scheduler(app)
    """
    # Create a background scheduler
    # BackgroundScheduler runs in a separate thread, non-blocking
    scheduler = BackgroundScheduler()
    
    # Add the reminder check job
    # - func: The function to run
    # - trigger: When to run (IntervalTrigger for periodic execution)
    # - id: Unique identifier for this job
    # - replace_existing: If a job with this ID exists, replace it
    scheduler.add_job(
        func=check_and_send_reminders,
        trigger=IntervalTrigger(minutes=CHECK_INTERVAL_MINUTES),
        id='reminder_check',
        name='Check and send automatic reminders',
        replace_existing=True
    )
    
    # Add overdue form check job (runs same interval as reminders)
    scheduler.add_job(
        func=check_overdue_forms,
        trigger=IntervalTrigger(minutes=CHECK_INTERVAL_MINUTES),
        id='overdue_check',
        name='Check for overdue forms and send notifications',
        replace_existing=True
    )
    
    # Start the scheduler
    scheduler.start()
    
    # Log startup message
    mode_str = "TEST MODE (every 1 minute)" if TEST_MODE else f"PRODUCTION (every {CHECK_INTERVAL_MINUTES} minutes)"
    print(f"\n{'='*60}")
    print(f"✅ AUTOMATIC REMINDER SCHEDULER STARTED")
    print(f"   Mode: {mode_str}")
    print(f"   Next check: {scheduler.get_job('reminder_check').next_run_time}")
    print(f"{'='*60}\n")
    
    return scheduler


# ============================================================================
# INITIAL EMAIL SENDING (for "immediate" first reminder timing)
# ============================================================================

def send_initial_emails(request_id: str, owner_id: str, form_title: str, form_url: str, group_id: str):
    """
    Send initial notification emails to all group members when a form request is created
    with first_reminder_timing set to 'immediate'.
    
    This function is called right after a form request is created (if timing is immediate),
    NOT by the scheduler. It sends a one-time notification to all group members.
    
    Args:
        request_id: The ID of the newly created form request
        owner_id: The ID of the user who owns this form request
        form_title: Title of the form
        form_url: URL to the Google Form
        group_id: ID of the group to notify
    
    Returns:
        dict: Summary of send results
    """
    from models.group import Group
    from models.org_membership import OrgMembership
    from utils.email_service import EmailService
    
    print(f"\n📨 Sending initial emails for '{form_title}'...")
    
    # Get the group
    group = Group.get_by_id(group_id)
    if not group:
        print(f"   ⚠️ Group {group_id} not found")
        return {'success': False, 'error': 'Group not found'}
    
    sent = 0
    skipped_opted_out = 0
    failed = 0
    
    for member in group.members:
        member_email = member['email']
        
        # Check if member has opted out
        if OrgMembership.is_opted_out(owner_id, member_email):
            skipped_opted_out += 1
            print(f"   🚫 Skipped {member_email} (opted out)")
            continue
        
        # Send the initial notification email
        # skip_rate_limit=True because this is the initial send, not a reminder
        result = EmailService.send_reminder(
            request_id,
            form_title,
            form_url,
            member_email,
            owner_id=owner_id,
            skip_rate_limit=True  # Don't rate limit the initial send
        )
        
        if result.get('success'):
            sent += 1
        else:
            failed += 1
            print(f"   ❌ Failed to send to {member_email}: {result.get('error')}")
    
    print(f"   ✅ Initial emails sent: {sent}")
    if skipped_opted_out:
        print(f"   🚫 Opted out: {skipped_opted_out}")
    if failed:
        print(f"   ❌ Failed: {failed}")
    
    return {
        'success': True,
        'sent': sent,
        'skipped_opted_out': skipped_opted_out,
        'failed': failed,
        'total_members': len(group.members)
    }
