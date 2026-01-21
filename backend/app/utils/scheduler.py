"""
APScheduler-based background scheduler for automated email reminders.
Supports both advanced mode (due_date + calculated_reminder_dates) and 
simple interval mode (schedule_interval_days).
"""

import os
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from models.database import get_db, Collections


# TEST_MODE: Set to True for 1-minute intervals (testing), False for 24-hour intervals (production)
TEST_MODE = os.environ.get('SCHEDULER_TEST_MODE', 'false').lower() == 'true'

# Scheduler instance
scheduler = None


class ReminderScheduler:
    """Handles automated reminder scheduling and sending"""
    
    # Check interval: 1 minute for testing, 1 hour for production
    CHECK_INTERVAL_MINUTES = 1 if TEST_MODE else 60
    
    @staticmethod
    def get_form_request_owner(form_request: dict) -> dict:
        """Get the owner user document for a form request"""
        try:
            db = get_db()
            owner_id = form_request.get('owner_id')
            if not owner_id:
                return None
            
            user_ref = db.collection(Collections.USERS).document(owner_id)
            user_doc = user_ref.get()
            
            if user_doc.exists:
                return user_doc.to_dict()
            return None
        except Exception as e:
            print(f"❌ Error getting form request owner: {e}")
            return None
    
    @staticmethod
    def get_group_members(group_id: str) -> list:
        """Get the list of member emails for a group"""
        try:
            db = get_db()
            group_ref = db.collection(Collections.GROUPS).document(group_id)
            group_doc = group_ref.get()
            
            if group_doc.exists:
                group_data = group_doc.to_dict()
                return group_data.get('members', [])
            return []
        except Exception as e:
            print(f"❌ Error getting group members: {e}")
            return []
    
    @staticmethod
    def get_responded_emails(request_id: str) -> set:
        """Get the set of emails that have already responded to a form request"""
        try:
            db = get_db()
            responses = db.collection(Collections.RESPONSES)\
                .where('request_id', '==', request_id)\
                .stream()
            
            responded = set()
            for response in responses:
                data = response.to_dict()
                email = data.get('respondent_email', '')
                if email:
                    responded.add(email.lower().strip())
            
            return responded
        except Exception as e:
            print(f"❌ Error getting responded emails: {e}")
            return set()
    
    @staticmethod
    def should_send_reminder_advanced(form_request: dict) -> bool:
        """
        Check if a reminder should be sent for an advanced mode form request.
        Advanced mode uses due_date and calculated_reminder_dates.
        """
        now = datetime.utcnow()
        
        # Check if schedule is enabled
        if not form_request.get('schedule_enabled', True):
            return False
        
        # Check if form is active
        if not form_request.get('is_active', True):
            return False
        
        # Check due date
        due_date_str = form_request.get('due_date')
        if not due_date_str:
            return False
        
        try:
            due_date = datetime.fromisoformat(due_date_str.replace('Z', '+00:00'))
            due_date = due_date.replace(tzinfo=None)  # Work with naive datetime
            
            if now > due_date:
                print(f"  Skipping: past due date ({due_date_str})")
                return False
        except (ValueError, AttributeError):
            return False
        
        # Get reminder schedule configuration
        reminder_schedule = form_request.get('reminder_schedule', {})
        if isinstance(reminder_schedule, str):
            # Legacy format - just a schedule type string
            return False
        
        calculated_dates = reminder_schedule.get('calculated_reminder_dates', [])
        if not calculated_dates:
            return False
        
        # Check if today matches any reminder date
        today_date = now.date()
        
        for date_str in calculated_dates:
            try:
                reminder_datetime = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                reminder_datetime = reminder_datetime.replace(tzinfo=None)
                
                # Check if this reminder date is today (comparing just dates)
                if reminder_datetime.date() == today_date:
                    return True
                    
            except (ValueError, AttributeError):
                continue
        
        return False
    
    @staticmethod
    def should_send_scheduled_first_reminder(form_request: dict) -> bool:
        """
        Check if the scheduled first reminder should be sent.
        This handles the case where first_reminder_timing is 'scheduled'.
        """
        from datetime import timezone
        now = datetime.now(timezone.utc)
        
        # Check if schedule is enabled
        if not form_request.get('schedule_enabled', True):
            return False
        
        # Check if form is active
        if not form_request.get('is_active', True):
            return False
        
        # Check if first reminder was already sent
        if form_request.get('first_reminder_sent', False):
            return False
        
        # Get first reminder timing config
        first_reminder_timing = form_request.get('first_reminder_timing', {})
        if isinstance(first_reminder_timing, str):
            # Legacy format or 'immediate' - skip (handled at creation)
            return False
        
        timing_type = first_reminder_timing.get('timing_type')
        if timing_type != 'scheduled':
            return False
        
        # Get the scheduled date
        scheduled_date_str = first_reminder_timing.get('scheduled_date')
        if not scheduled_date_str:
            return False
        
        try:
            scheduled_date = datetime.fromisoformat(scheduled_date_str.replace('Z', '+00:00'))
            
            # Check if it's time to send (current time >= scheduled time)
            if now >= scheduled_date:
                return True
                
        except (ValueError, AttributeError) as e:
            print(f"  Error parsing scheduled_date: {e}")
        
        return False
    
    @staticmethod
    def mark_first_reminder_sent(request_id: str):
        """Mark the first reminder as sent for a form request"""
        try:
            db = get_db()
            
            db.collection(Collections.FORM_REQUESTS).document(request_id).update({
                'first_reminder_sent': True,
                'first_reminder_sent_at': datetime.utcnow().isoformat() + 'Z'
            })
            
            print(f"  ✅ Marked first reminder as sent")
            
        except Exception as e:
            print(f"  ❌ Error marking first reminder as sent: {e}")
    
    @staticmethod
    def should_send_reminder_simple(form_request: dict) -> bool:
        """
        Check if a reminder should be sent for a simple interval mode form request.
        Simple mode uses schedule_interval_days and schedule_next_send.
        """
        now = datetime.utcnow()
        
        # Check if schedule is enabled
        if not form_request.get('schedule_enabled', True):
            return False
        
        # Check if form is active
        if not form_request.get('is_active', True):
            return False
        
        # Check end date if specified
        end_date_str = form_request.get('schedule_end_date')
        if end_date_str:
            try:
                end_date = datetime.fromisoformat(end_date_str.replace('Z', '+00:00'))
                end_date = end_date.replace(tzinfo=None)
                
                if now > end_date:
                    print(f"  Skipping: past end date ({end_date_str})")
                    return False
            except (ValueError, AttributeError):
                pass
        
        # Check if it's time to send
        next_send_str = form_request.get('schedule_next_send')
        if not next_send_str:
            return False
        
        try:
            next_send = datetime.fromisoformat(next_send_str.replace('Z', '+00:00'))
            next_send = next_send.replace(tzinfo=None)
            
            if now >= next_send:
                return True
        except (ValueError, AttributeError):
            pass
        
        return False
    
    @staticmethod
    def update_next_send_time(request_id: str, interval_days: int):
        """Update the next scheduled send time for a simple mode form request"""
        try:
            db = get_db()
            
            if TEST_MODE:
                # For testing, schedule next send in 1 minute
                next_send = datetime.utcnow() + timedelta(minutes=1)
            else:
                # For production, schedule next send based on interval
                next_send = datetime.utcnow() + timedelta(days=interval_days)
            
            db.collection(Collections.FORM_REQUESTS).document(request_id).update({
                'schedule_next_send': next_send.isoformat() + 'Z',
                'schedule_last_sent': datetime.utcnow().isoformat() + 'Z'
            })
            
            print(f"  ✅ Updated next send time to {next_send.isoformat()}")
            
        except Exception as e:
            print(f"  ❌ Error updating next send time: {e}")
    
    @staticmethod
    def mark_reminder_sent_for_date(request_id: str, date_str: str):
        """Mark a calculated reminder date as sent"""
        try:
            db = get_db()
            
            # Get current form request
            doc_ref = db.collection(Collections.FORM_REQUESTS).document(request_id)
            doc = doc_ref.get()
            
            if not doc.exists:
                return
            
            form_request = doc.to_dict()
            reminder_schedule = form_request.get('reminder_schedule', {})
            sent_dates = reminder_schedule.get('sent_reminder_dates', [])
            
            if date_str not in sent_dates:
                sent_dates.append(date_str)
                reminder_schedule['sent_reminder_dates'] = sent_dates
                
                doc_ref.update({
                    'reminder_schedule': reminder_schedule,
                    'schedule_last_sent': datetime.utcnow().isoformat() + 'Z'
                })
                
                print(f"  ✅ Marked reminder date as sent: {date_str}")
                
        except Exception as e:
            print(f"  ❌ Error marking reminder as sent: {e}")
    
    @staticmethod
    def check_and_send_reminders():
        """
        Main scheduler job: Check all form requests and send reminders as needed.
        This runs periodically based on CHECK_INTERVAL_MINUTES.
        """
        from utils.email_service import EmailService
        
        print(f"\n{'='*60}")
        print(f"🔔 REMINDER CHECK - {datetime.utcnow().isoformat()}")
        print(f"   Mode: {'TEST' if TEST_MODE else 'PRODUCTION'}")
        print(f"{'='*60}")
        
        try:
            db = get_db()
            
            # Get all active form requests
            form_requests = db.collection(Collections.FORM_REQUESTS)\
                .where('is_active', '==', True)\
                .stream()
            
            total_requests = 0
            reminders_sent = 0
            
            for doc in form_requests:
                request_id = doc.id
                form_request = doc.to_dict()
                total_requests += 1
                
                title = form_request.get('title', 'Unknown Form')
                print(f"\n📋 Checking: {title} (ID: {request_id})")
                
                # Determine which mode this form request uses
                is_advanced_mode = 'due_date' in form_request and isinstance(form_request.get('reminder_schedule'), dict)
                is_simple_mode = 'schedule_interval_days' in form_request
                
                should_send = False
                mode = None
                is_first_reminder = False
                
                # First, check if scheduled first reminder should be sent
                if ReminderScheduler.should_send_scheduled_first_reminder(form_request):
                    mode = "scheduled_first"
                    should_send = True
                    is_first_reminder = True
                    print(f"  📅 Scheduled first reminder is due!")
                elif is_advanced_mode:
                    mode = "advanced"
                    should_send = ReminderScheduler.should_send_reminder_advanced(form_request)
                    
                    # Check if we already sent for today
                    if should_send:
                        today_str = datetime.utcnow().date().isoformat()
                        sent_dates = form_request.get('reminder_schedule', {}).get('sent_reminder_dates', [])
                        
                        # Check if any sent date matches today
                        for sent_date in sent_dates:
                            try:
                                sent_datetime = datetime.fromisoformat(sent_date.replace('Z', '+00:00'))
                                if sent_datetime.date().isoformat() == today_str:
                                    print(f"  Already sent reminder for today ({today_str})")
                                    should_send = False
                                    break
                            except (ValueError, AttributeError):
                                continue
                
                elif is_simple_mode:
                    mode = "simple"
                    should_send = ReminderScheduler.should_send_reminder_simple(form_request)
                else:
                    print(f"  ⚠️ No scheduling mode detected, skipping")
                    continue
                
                if not should_send:
                    print(f"  ⏳ Not time for reminder (mode: {mode})")
                    continue
                
                print(f"  ✅ Time to send reminders (mode: {mode})")
                
                # Get group members
                group_id = form_request.get('group_id')
                if not group_id:
                    print(f"  ⚠️ No group_id, skipping")
                    continue
                
                members = ReminderScheduler.get_group_members(group_id)
                if not members:
                    print(f"  ⚠️ No members in group, skipping")
                    continue
                
                print(f"  👥 Group has {len(members)} members")
                
                # Get responded emails
                responded = ReminderScheduler.get_responded_emails(request_id)
                print(f"  ✅ {len(responded)} have already responded")
                
                # Filter out members who already responded
                form_url = form_request.get('form_url', '')
                
                for member in members:
                    member_email = member.get('email', '') if isinstance(member, dict) else member
                    
                    if not member_email:
                        continue
                    
                    if member_email.lower().strip() in responded:
                        print(f"  ⏭️ {member_email} already responded, skipping")
                        continue
                    
                    # Send reminder
                    print(f"  📧 Sending reminder to {member_email}...")
                    result = EmailService.send_reminder(
                        request_id=request_id,
                        form_title=title,
                        form_url=form_url,
                        recipient_email=member_email,
                        skip_rate_limit=True  # Scheduler manages its own timing
                    )
                    
                    if result.get('success'):
                        reminders_sent += 1
                        print(f"  ✅ Sent to {member_email}")
                    else:
                        print(f"  ❌ Failed: {result.get('error', 'Unknown error')}")
                
                # Update scheduling info after sending
                if is_first_reminder:
                    # Mark the scheduled first reminder as sent
                    ReminderScheduler.mark_first_reminder_sent(request_id)
                elif is_simple_mode:
                    interval_days = form_request.get('schedule_interval_days', 1)
                    ReminderScheduler.update_next_send_time(request_id, interval_days)
                elif is_advanced_mode:
                    # Mark today's reminder date as sent
                    today_iso = datetime.utcnow().isoformat() + 'Z'
                    ReminderScheduler.mark_reminder_sent_for_date(request_id, today_iso)
            
            print(f"\n{'='*60}")
            print(f"📊 SUMMARY: Checked {total_requests} requests, sent {reminders_sent} reminders")
            print(f"{'='*60}\n")
            
        except Exception as e:
            import traceback
            print(f"❌ Scheduler error: {e}")
            traceback.print_exc()


def init_scheduler(app):
    """Initialize the APScheduler with the Flask app context"""
    global scheduler
    
    if scheduler is not None:
        print("⚠️ Scheduler already initialized, skipping...")
        return scheduler
    
    print(f"\n{'='*60}")
    print(f"🚀 INITIALIZING REMINDER SCHEDULER")
    print(f"   Mode: {'TEST (1-minute intervals)' if TEST_MODE else 'PRODUCTION (hourly checks)'}")
    print(f"   Check interval: {ReminderScheduler.CHECK_INTERVAL_MINUTES} minutes")
    print(f"{'='*60}\n")
    
    scheduler = BackgroundScheduler()
    
    # Add the reminder check job
    scheduler.add_job(
        func=lambda: run_with_app_context(app, ReminderScheduler.check_and_send_reminders),
        trigger=IntervalTrigger(minutes=ReminderScheduler.CHECK_INTERVAL_MINUTES),
        id='reminder_check',
        name='Check and send reminders',
        replace_existing=True
    )
    
    scheduler.start()
    print("✅ Scheduler started successfully!")
    
    # Run an initial check after a short delay
    import threading
    def initial_check():
        import time
        time.sleep(5)  # Wait 5 seconds for app to fully start
        print("\n🔔 Running initial reminder check...")
        run_with_app_context(app, ReminderScheduler.check_and_send_reminders)
    
    threading.Thread(target=initial_check, daemon=True).start()
    
    return scheduler


def run_with_app_context(app, func):
    """Run a function within the Flask app context"""
    with app.app_context():
        func()


def shutdown_scheduler():
    """Gracefully shutdown the scheduler"""
    global scheduler
    
    if scheduler is not None:
        print("🛑 Shutting down scheduler...")
        scheduler.shutdown(wait=False)
        scheduler = None
        print("✅ Scheduler stopped")
