# Automated Reminder Scheduler
# Runs in background to send scheduled reminders

from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
import atexit

# ========== TEST MODE ==========
# Set to True for testing (1 minute interval, skip rate limits)
# Set to False for production (1 hour interval, respect rate limits)
TEST_MODE = True
# ===============================


class ReminderScheduler:
    """Background scheduler for sending automated reminders"""
    
    _instance = None
    _scheduler = None
    
    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    def __init__(self):
        self._scheduler = BackgroundScheduler()
        
        if TEST_MODE:
            interval = IntervalTrigger(minutes=1)
            interval_text = "1 minute"
        else:
            interval = IntervalTrigger(hours=1)
            interval_text = "1 hour"
        
        self._scheduler.add_job(
            func=self.check_and_send_reminders,
            trigger=interval,
            id='reminder_check',
            name='Check and send scheduled reminders',
            replace_existing=True
        )
        self._interval_text = interval_text
    
    def start(self):
        """Start the scheduler"""
        if not self._scheduler.running:
            self._scheduler.start()
            mode = "⚠️ TEST MODE" if TEST_MODE else "PRODUCTION"
            print(f"✅ Reminder scheduler started ({mode} - runs every {self._interval_text})")
            atexit.register(lambda: self.shutdown())
    
    def shutdown(self):
        """Shutdown the scheduler"""
        if self._scheduler.running:
            self._scheduler.shutdown()
            print("🛑 Reminder scheduler stopped")
    
    def check_and_send_reminders(self):
        """Main job: check all form requests and send due reminders"""
        from models.database import get_db, Collections
        from models.group import Group
        from utils.email_service import EmailService
        
        print(f"\n{'='*50}")
        print(f"🔄 Scheduler running at {datetime.utcnow().isoformat()}Z")
        print(f"{'='*50}")
        
        try:
            db = get_db()
            now = datetime.utcnow()
            now_str = now.isoformat() + 'Z'
            
            # Get all active form requests with scheduling enabled
            form_requests = db.collection(Collections.FORM_REQUESTS)\
                .where('schedule_enabled', '==', True)\
                .where('schedule_paused', '==', False)\
                .stream()
            
            requests_processed = 0
            reminders_sent = 0
            
            for req_doc in form_requests:
                req_data = req_doc.to_dict()
                request_id = req_doc.id
                
                # Check if past end date (skip this check in test mode)
                if not TEST_MODE:
                    end_date_str = req_data.get('schedule_end_date', '')
                    if end_date_str and end_date_str < now_str:
                        print(f"  ⏭️ Skipping {request_id}: Past end date ({end_date_str})")
                        db.collection(Collections.FORM_REQUESTS).document(request_id).update({
                            'schedule_enabled': False,
                            'schedule_disabled_reason': 'End date reached',
                            'schedule_disabled_at': now_str
                        })
                        continue
                
                # Check if it's time to send (skip this check in test mode)
                if not TEST_MODE:
                    next_send_str = req_data.get('schedule_next_send', '')
                    if not next_send_str or next_send_str > now_str:
                        print(f"  ⏳ Skipping {request_id}: Not yet time (next: {next_send_str})")
                        continue
                
                print(f"\n📧 Processing request: {request_id}")
                print(f"   Title: {req_data.get('title', 'Unknown')}")
                
                requests_processed += 1
                
                # Get the group members
                group_id = req_data.get('group_id')
                if not group_id:
                    print(f"   ⚠️ No group_id, skipping")
                    continue
                
                group = Group.get_by_id(group_id)
                if not group:
                    print(f"   ⚠️ Group not found, skipping")
                    continue
                
                # Get current responses to find non-responders
                responses = db.collection(Collections.RESPONSES)\
                    .where('request_id', '==', request_id)\
                    .stream()
                
                responded_emails = set()
                for resp in responses:
                    email = resp.to_dict().get('respondent_email', '').lower()
                    if email:
                        responded_emails.add(email)
                
                # Find non-responders (members are dicts with 'email' key)
                non_responders = []
                for m in group.members:
                    member_email = m.get('email', '') if isinstance(m, dict) else m
                    if member_email and member_email.lower() not in responded_emails:
                        non_responders.append(member_email)
                
                print(f"   Members: {len(group.members)}, Responded: {len(responded_emails)}, Pending: {len(non_responders)}")
                
                # Send reminders to non-responders
                form_title = req_data.get('title', 'Form')
                form_url = req_data.get('form_url', '')
                
                sent_count = 0
                skipped_count = 0
                
                for email in non_responders:
                    result = EmailService.send_reminder(
                        request_id=request_id,
                        form_title=form_title,
                        form_url=form_url,
                        recipient_email=email,
                        skip_rate_limit=TEST_MODE  # Skip rate limit in test mode
                    )
                    
                    if result.get('success'):
                        sent_count += 1
                        reminders_sent += 1
                    else:
                        skipped_count += 1
                        print(f"   ⏭️ Skipped {email}: {result.get('error', 'Unknown')}")
                
                print(f"   ✅ Sent: {sent_count}, Skipped: {skipped_count}")
                
                # Calculate next send time
                if TEST_MODE:
                    next_send = now + timedelta(minutes=1)  # 1 minute in test mode
                else:
                    interval_days = req_data.get('schedule_interval_days', 3)
                    next_send = now + timedelta(days=interval_days)
                next_send_str = next_send.isoformat() + 'Z'
                
                # Update the form request
                db.collection(Collections.FORM_REQUESTS).document(request_id).update({
                    'schedule_last_sent': now_str,
                    'schedule_next_send': next_send_str
                })
                
                print(f"   📅 Next send: {next_send_str}")
            
            print(f"\n{'='*50}")
            print(f"✅ Scheduler complete: {requests_processed} requests processed, {reminders_sent} reminders sent")
            print(f"{'='*50}\n")
            
        except Exception as e:
            import traceback
            print(f"❌ Scheduler error: {e}")
            traceback.print_exc()
    
    def run_now(self):
        """Manually trigger a reminder check (for testing)"""
        print("🔧 Manual scheduler trigger requested")
        self.check_and_send_reminders()


def init_scheduler(app):
    """Initialize and start the scheduler with Flask app context"""
    scheduler = ReminderScheduler.get_instance()
    
    # Wrap the job to run within app context
    original_job = scheduler.check_and_send_reminders
    
    def job_with_context():
        with app.app_context():
            original_job()
    
    # Replace the job function
    scheduler.check_and_send_reminders = job_with_context
    
    scheduler.start()
    return scheduler
