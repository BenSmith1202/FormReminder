# Form Request Model
# Manages Form Requests

from typing import Dict, List
from models.database import get_db, Collections
from models import response

class FormRequest:
    """Represents a form request"""
    
    def __init__(self, frq_id: str, title: str, created_at: str, description: str, 
                 due_date: str, first_reminder_timing: Dict, form_settings: Dict, 
                 form_url: str, google_form_id: str, group_id: str, is_active: bool, 
                 owner_id: str, reminder_schedule: Dict, response_count: int, schedule_enabled: bool,
                 status: str, total_recipients: int, warnings: List):
        self.id = frq_id
        self.title = title
        self.created_at = created_at
        self.description = description
        self.due_date = due_date
        self.first_reminder_timing = first_reminder_timing
        self.form_settings = form_settings
        self.form_url = form_url
        self.google_form_id = google_form_id
        self.group_id = group_id
        self.is_active = is_active
        self.owner_id = owner_id
        self.reminder_schedule = reminder_schedule
        self.response_count = response_count
        self.schedule_enabled = schedule_enabled
        self.status = status
        self.total_recipients = total_recipients
        self.warnings = warnings
        
    
    def to_dict(self) -> Dict:
        """Convert group to dictionary"""
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'owner_id': self.owner_id,
            'group_id': self.group_id
        }
    
    @staticmethod
    def delete_frq(frq_id: str):
        """Deletes a form request, given its id. Also deletes all associated responses"""
        try:
            db = get_db()
            frq_ref = db.collection(Collections.FORM_REQUESTS).document(frq_id)
            frq_ref.delete()
            print(f"Form Request associated with id {frq_id} deleted")

            print(f"Attempting to delete associated responses...")
            response_refs = db.collection(Collections.RESPONSES)
            for resp in response_refs:
                if(resp.request_id == frq_id):
                    response.delete_reponse(resp.id)
            
        except Exception as e:
            print(f"Error deleting form request: {e}")
            import traceback
            traceback.print_exc()
            return None