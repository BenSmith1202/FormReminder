import datetime
from models.database import get_db, Collections
from google.cloud import firestore

class Form:
    def __init__(self, 
                 created_at: datetime, 
                 description: str, 
                 fields: list,
                 is_active: bool,
                 organization_id: str,
                 owner_id: str,
                 title: str,
                 updated_at: datetime):
        self.created_at = created_at
        self.description = description
        self.fields = fields
        self.is_active = is_active
        self.organizatioon_id = organization_id
        self.owner_id = owner_id
        self.title = title
        self.updated_at = updated_at

    @staticmethod
    def get_forms_by_userid(userid: str):
        try:
            db = get_db()
            docs_ref = db.collection("forms").where(filter=firestore.FieldFilter("owner_id", "==", userid)).stream()

            docsList = []

            for doc in docs_ref:
                dicted_doc = doc.to_dict()
                print(dicted_doc)
                docsList.append({
                    "id": dicted_doc.get('google_form_id'),
                    "title": dicted_doc.get('title'),
                    "notificationsEnabled": False
                    })
            
            return docsList
        
        except Exception as e:
            print(f"Error getting forms by user ID: {e}")
            import traceback
            traceback.print_exc()
            return None
        