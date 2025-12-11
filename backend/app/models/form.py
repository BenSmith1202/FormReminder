import datetime

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