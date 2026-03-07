# Notification Model
# Manages in-app notifications for users

from typing import Dict, List, Optional
from datetime import datetime
from models.database import get_db, Collections


class NotificationType:
    """Constants for notification types"""
    FORM_COMPLETED = "form_completed"               # Form has been fully completed
    FORM_SUBMISSION = "form_submission"             # Someone submitted a response
    FORM_OVERDUE = "form_overdue"                   # Form hit due date without completion
    MEMBER_OPTED_OUT = "member_opted_out"           # Group member opted out of reminders
    UNRECOGNIZED_SUBMISSION = "unrecognized_submission"  # Unknown email submitted a response


class Notification:
    """Represents an in-app notification"""
    
    def __init__(self, notification_id: str, user_id: str, notification_type: str,
                 message: str, form_reminder_id: Optional[str], is_read: bool,
                 created_at: str, metadata: Optional[Dict] = None):
        self.id = notification_id
        self.user_id = user_id
        self.type = notification_type
        self.message = message
        self.form_reminder_id = form_reminder_id  # Links to form reminder detail page
        self.is_read = is_read
        self.created_at = created_at
        self.metadata = metadata or {}  # Extra data (email address, form name, etc.)

    def to_dict(self) -> Dict:
        """Convert notification to dictionary for API responses"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'type': self.type,
            'message': self.message,
            'form_reminder_id': self.form_reminder_id,
            'is_read': self.is_read,
            'created_at': self.created_at,
            'metadata': self.metadata
        }

    @staticmethod
    def from_dict(notification_id: str, data: Dict) -> 'Notification':
        """Create Notification instance from Firestore document"""
        return Notification(
            notification_id=notification_id,
            user_id=data.get('user_id', ''),
            notification_type=data.get('type', ''),
            message=data.get('message', ''),
            form_reminder_id=data.get('form_reminder_id'),
            is_read=data.get('is_read', False),
            created_at=data.get('created_at', ''),
            metadata=data.get('metadata', {})
        )

    @staticmethod
    def create(user_id: str, notification_type: str, message: str,
               form_reminder_id: Optional[str] = None, metadata: Optional[Dict] = None) -> Optional['Notification']:
        """Create a new notification for a user"""
        try:
            db = get_db()
            notifications_ref = db.collection(Collections.NOTIFICATIONS)
            
            now = datetime.utcnow().isoformat()
            notification_data = {
                'user_id': user_id,
                'type': notification_type,
                'message': message,
                'form_reminder_id': form_reminder_id,
                'is_read': False,
                'created_at': now,
                'metadata': metadata or {}
            }
            
            doc_ref = notifications_ref.add(notification_data)
            notification_id = doc_ref[1].id
            
            print(f"Notification created: {notification_id} for user {user_id}")
            return Notification.from_dict(notification_id, notification_data)
            
        except Exception as e:
            print(f"Error creating notification: {e}")
            import traceback
            traceback.print_exc()
            return None

    @staticmethod
    def get_for_user(user_id: str, limit: int = 50, include_read: bool = True) -> List['Notification']:
        """Get notifications for a user, ordered by most recent first"""
        try:
            db = get_db()
            notifications_ref = db.collection(Collections.NOTIFICATIONS)
            
            # Simple query without ordering to avoid needing composite index
            query = notifications_ref.where('user_id', '==', user_id)
            
            if not include_read:
                query = query.where('is_read', '==', False)
            
            # Fetch all matching notifications
            notifications = []
            for doc in query.stream():
                notifications.append(Notification.from_dict(doc.id, doc.to_dict()))
            
            # Sort in Python by created_at descending (newest first)
            notifications.sort(key=lambda n: n.created_at, reverse=True)
            
            # Apply limit after sorting
            return notifications[:limit]
            
        except Exception as e:
            print(f"Error fetching notifications: {e}")
            import traceback
            traceback.print_exc()
            return []

    @staticmethod
    def get_unread_count(user_id: str) -> int:
        """Get count of unread notifications for the bell badge"""
        try:
            db = get_db()
            notifications_ref = db.collection(Collections.NOTIFICATIONS)
            
            query = notifications_ref.where('user_id', '==', user_id).where('is_read', '==', False)
            
            # Count documents
            count = 0
            for _ in query.stream():
                count += 1
            
            return count
            
        except Exception as e:
            print(f"Error counting unread notifications: {e}")
            return 0

    @staticmethod
    def mark_as_read(notification_id: str) -> bool:
        """Mark a single notification as read"""
        try:
            db = get_db()
            notification_ref = db.collection(Collections.NOTIFICATIONS).document(notification_id)
            notification_ref.update({'is_read': True})
            print(f"Notification {notification_id} marked as read")
            return True
            
        except Exception as e:
            print(f"Error marking notification as read: {e}")
            return False

    @staticmethod
    def mark_all_as_read(user_id: str) -> bool:
        """Mark all notifications for a user as read"""
        try:
            db = get_db()
            notifications_ref = db.collection(Collections.NOTIFICATIONS)
            
            query = notifications_ref.where('user_id', '==', user_id).where('is_read', '==', False)
            
            for doc in query.stream():
                doc.reference.update({'is_read': True})
            
            print(f"All notifications marked as read for user {user_id}")
            return True
            
        except Exception as e:
            print(f"Error marking all notifications as read: {e}")
            return False

    @staticmethod
    def delete(notification_id: str) -> bool:
        """Delete a notification"""
        try:
            db = get_db()
            notification_ref = db.collection(Collections.NOTIFICATIONS).document(notification_id)
            notification_ref.delete()
            print(f"Notification {notification_id} deleted")
            return True
            
        except Exception as e:
            print(f"Error deleting notification: {e}")
            return False


# Helper functions for creating specific notification types

def notify_form_completed(user_id: str, form_name: str, form_reminder_id: str) -> Optional[Notification]:
    """Create notification when a form is fully completed"""
    message = f"Form '{form_name}' has been completed!"
    return Notification.create(
        user_id=user_id,
        notification_type=NotificationType.FORM_COMPLETED,
        message=message,
        form_reminder_id=form_reminder_id,
        metadata={'form_name': form_name}
    )


def notify_form_submission(user_id: str, form_name: str, form_reminder_id: str, 
                           respondent_email: str) -> Optional[Notification]:
    """Create notification when someone submits a form response"""
    message = f"New submission received for '{form_name}'"
    return Notification.create(
        user_id=user_id,
        notification_type=NotificationType.FORM_SUBMISSION,
        message=message,
        form_reminder_id=form_reminder_id,
        metadata={'form_name': form_name, 'respondent_email': respondent_email}
    )


def notify_form_overdue(user_id: str, form_name: str, form_reminder_id: str) -> Optional[Notification]:
    """Create notification when a form hits its due date without completion"""
    message = f"Form '{form_name}' is overdue!"
    return Notification.create(
        user_id=user_id,
        notification_type=NotificationType.FORM_OVERDUE,
        message=message,
        form_reminder_id=form_reminder_id,
        metadata={'form_name': form_name}
    )


def notify_member_opted_out(user_id: str, email: str, form_reminder_id: Optional[str] = None,
                            form_name: Optional[str] = None) -> Optional[Notification]:
    """Create notification when a group member opts out of reminders"""
    message = f"{email} has opted out of your reminders"
    return Notification.create(
        user_id=user_id,
        notification_type=NotificationType.MEMBER_OPTED_OUT,
        message=message,
        form_reminder_id=form_reminder_id,
        metadata={'email': email, 'form_name': form_name}
    )


def notify_unrecognized_submission(user_id: str, form_name: str, form_reminder_id: str,
                                    respondent_email: str) -> Optional[Notification]:
    """Create notification when an unrecognized email submits a form response"""
    message = f"Unknown email '{respondent_email}' submitted a response for '{form_name}'"
    return Notification.create(
        user_id=user_id,
        notification_type=NotificationType.UNRECOGNIZED_SUBMISSION,
        message=message,
        form_reminder_id=form_reminder_id,
        metadata={'form_name': form_name, 'respondent_email': respondent_email}
    )
