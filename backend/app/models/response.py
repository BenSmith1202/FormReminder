# Form Request Model
# Manages Form Requests

from typing import Dict, List
from models.database import get_db, Collections

class Response:
    """Represents a response"""

    @staticmethod
    def delete_response(response_id: str):
        """Deletes a response, given its id."""
        try:
            db = get_db()
            resp_ref = db.collection(Collections.RESPONSES).document(response_id)
            resp_ref.delete()
            print(f"Response associated with id {response_id} deleted")
            
        except Exception as e:
            print(f"Error deleting response: {e}")
            import traceback
            traceback.print_exc()
            return None
