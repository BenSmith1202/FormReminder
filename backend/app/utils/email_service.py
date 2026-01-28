# Email Service for sending reminders
import os
import smtplib
import hmac
import hashlib
import urllib.parse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from typing import Optional
from jinja2 import Environment, FileSystemLoader
from models.database import get_db, Collections
from config import settings
from models.org_membership import OrgMembership


class EmailService:
    """Service for sending email reminders to form recipients"""
    
    # Email configuration from environment variables
    SMTP_SERVER = "smtp.gmail.com"
    SMTP_PORT = 465  # Use SSL port instead of TLS port 587
    SMTP_USERNAME = "reminderform0@gmail.com"
    SMTP_PASSWORD = "mngnsqitifheoiid"  # Gmail App Password (spaces removed)
    FROM_EMAIL = "reminderform0@gmail.com"
    FROM_NAME = "FormReminder"
    
    # Rate limiting: 1 hour between reminders to same person
    RATE_LIMIT_HOURS = 1
    
    # Set up Jinja2 template environment
    TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'templates')
    jinja_env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))
    
    @staticmethod
    def get_email_template(form_title: str, form_url: str, recipient_email: str) -> str:
        """Load and render the email template with Jinja2"""
        template = EmailService.jinja_env.get_template('reminder_email.html')
        return template.render(
            form_title=form_title,
            form_url=form_url,
            recipient_email=recipient_email,
            unsubscribe_url=None
        )

    @staticmethod
    def _unsubscribe_token(owner_id: str, recipient_email: str) -> str:
        msg = f"{owner_id}:{recipient_email.strip().lower()}".encode("utf-8")
        key = (settings.SECRET_KEY or "").encode("utf-8")
        return hmac.new(key, msg, hashlib.sha256).hexdigest()

    @staticmethod
    def build_unsubscribe_url(owner_id: str, recipient_email: str) -> str:
        """
        Creates a signed URL that allows a recipient to leave (opt out of) an org.
        """
        email_norm = recipient_email.strip().lower()
        token = EmailService._unsubscribe_token(owner_id, email_norm)
        qs = urllib.parse.urlencode({"email": email_norm, "token": token})
        return f"{settings.BACKEND_PUBLIC_URL}/api/organizations/{owner_id}/leave?{qs}"

    @staticmethod
    def verify_unsubscribe_token(owner_id: str, recipient_email: str, token: str) -> bool:
        expected = EmailService._unsubscribe_token(owner_id, recipient_email.strip().lower())
        return hmac.compare_digest(expected, token or "")
    
    @staticmethod
    def send_email(to_email: str, subject: str, html_content: str) -> bool:
        """Send an email using Gmail SMTP"""
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['From'] = f"{EmailService.FROM_NAME} <{EmailService.FROM_EMAIL}>"
            msg['To'] = to_email
            msg['Subject'] = subject
            
            # Attach HTML content
            html_part = MIMEText(html_content, 'html')
            msg.attach(html_part)
            
            # Connect to Gmail SMTP with SSL (port 465)
            print(f"Connecting to {EmailService.SMTP_SERVER}:{EmailService.SMTP_PORT} with SSL...")
            server = smtplib.SMTP_SSL(EmailService.SMTP_SERVER, EmailService.SMTP_PORT, timeout=15)
            server.set_debuglevel(1)  # Enable debug output
            
            # Login
            print(f"Logging in as {EmailService.SMTP_USERNAME}...")
            server.login(EmailService.SMTP_USERNAME, EmailService.SMTP_PASSWORD)
            
            # Send email
            print(f"Sending email to {to_email}...")
            server.send_message(msg)
            server.quit()
            
            print(f"✅ Email sent successfully to {to_email}")
            return True
            
        except smtplib.SMTPAuthenticationError as auth_error:
            print(f"❌ SMTP Authentication failed: {str(auth_error)}")
            print(f"   Check that the password is correct and 2FA + App Password is enabled")
            return False
        except Exception as e:
            print(f"❌ Failed to send email to {to_email}: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
    
    @staticmethod
    def can_send_reminder(request_id: str, recipient_email: str) -> bool:
        """Check if enough time has passed since last reminder (rate limiting)"""
        try:
            db = get_db()
            
            # Check for recent reminders
            cutoff_time = datetime.utcnow() - timedelta(hours=EmailService.RATE_LIMIT_HOURS)
            cutoff_str = cutoff_time.isoformat() + 'Z'
            
            print(f"🔍 Checking rate limit for request={request_id}, email={recipient_email}, cutoff={cutoff_str}")
            
            # Query all logs for this request+email combo (without time filter first)
            all_logs = db.collection(Collections.EMAIL_LOGS)\
                .where('request_id', '==', request_id)\
                .where('recipient_email', '==', recipient_email)\
                .stream()
            
            found_recent = False
            for log in all_logs:
                log_data = log.to_dict()
                log_time = log_data.get('sent_at', '')
                print(f"  Found log: sent_at={log_time}, success={log_data.get('success')}")
                
                # Manual time comparison since Firestore might not have index
                if log_time >= cutoff_str and log_data.get('success', False):
                    print(f"  ⛔ Rate limit triggered: {log_time} >= {cutoff_str}")
                    found_recent = True
                    break
            
            if found_recent:
                print(f"Rate limit: Already sent to {recipient_email} within last {EmailService.RATE_LIMIT_HOURS} hour(s)")
                return False
            
            print(f"✅ No recent sends found, rate limit OK")
            return True
            
        except Exception as e:
            print(f"Error checking rate limit: {e}")
            # On error, allow sending (fail open)
            return True
    
    @staticmethod
    def log_email_sent(request_id: str, recipient_email: str, success: bool):
        """Log email send attempt to database"""
        try:
            db = get_db()
            
            log_data = {
                'request_id': request_id,
                'recipient_email': recipient_email,
                'sent_at': datetime.utcnow().isoformat() + 'Z',
                'success': success
            }
            
            db.collection(Collections.EMAIL_LOGS).add(log_data)
            print(f"✅ Logged email send to {recipient_email}")
            
        except Exception as e:
            print(f"⚠️ Failed to log email: {e}")
            # Don't fail the whole operation if logging fails
    
    @staticmethod
    def send_reminder(
        request_id: str,
        form_title: str,
        form_url: str,
        recipient_email: str,
        *,
        owner_id: Optional[str] = None,
        skip_rate_limit: bool = False,
    ) -> dict:
        """Send a reminder email to a single recipient"""

        # Org-level opt-out suppression
        if owner_id and OrgMembership.is_opted_out(owner_id, recipient_email):
            return {
                "success": False,
                "error": "Recipient has opted out of this organization",
                "opted_out": True,
            }
        
        # Check rate limit
        if not skip_rate_limit and not EmailService.can_send_reminder(request_id, recipient_email):
            return {
                'success': False,
                'error': f'Rate limit: Already sent to {recipient_email} within last {EmailService.RATE_LIMIT_HOURS} hour(s)'
            }
        
        # Generate email content
        subject = f"Reminder: Please Complete {form_title}"
        unsubscribe_url = EmailService.build_unsubscribe_url(owner_id, recipient_email) if owner_id else None
        template = EmailService.jinja_env.get_template("reminder_email.html")
        html_content = template.render(
            form_title=form_title,
            form_url=form_url,
            recipient_email=recipient_email,
            unsubscribe_url=unsubscribe_url,
        )
        
        # Send email
        success = EmailService.send_email(recipient_email, subject, html_content)
        
        # Log the attempt
        EmailService.log_email_sent(request_id, recipient_email, success)
        
        if success:
            return {'success': True, 'message': f'Reminder sent to {recipient_email}'}
        else:
            return {'success': False, 'error': 'Failed to send email'}
