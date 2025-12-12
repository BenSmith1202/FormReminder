# Group Model
# Manages groups, members, and invite tokens

import uuid
import re
from datetime import datetime
from typing import Optional, List, Dict
from models.database import get_db, Collections


class Group:
    """Represents a group with members for form request tracking"""
    
    def __init__(self, group_id: str, name: str, description: str, owner_id: str, 
                 invite_token: str, created_at: str, updated_at: str = None, members: List[Dict] = None):
        self.id = group_id
        self.name = name
        self.description = description
        self.owner_id = owner_id
        self.invite_token = invite_token
        self.created_at = created_at
        self.updated_at = updated_at
        self.members = members or []
    
    def to_dict(self) -> Dict:
        """Convert group to dictionary"""
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'owner_id': self.owner_id,
            'invite_token': self.invite_token,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'members': self.members,
            'member_count': len(self.members)
        }
    
    @staticmethod
    def create_group(name: str, description: str, owner_id: str) -> Optional['Group']:
        """Create a new group with auto-generated invite token"""
        try:
            db = get_db()
            groups_ref = db.collection(Collections.GROUPS)
            
            # Generate unique invite token
            invite_token = str(uuid.uuid4())
            
            group_data = {
                'name': name,
                'description': description,
                'owner_id': owner_id,
                'invite_token': invite_token,
                'members': [],
                'created_at': datetime.utcnow().isoformat() + 'Z',
                'updated_at': datetime.utcnow().isoformat() + 'Z'
            }
            
            # Add to database
            doc_ref = groups_ref.document()
            doc_ref.set(group_data)
            
            print(f"✅ Group created: {doc_ref.id} - {name}")
            
            return Group(
                group_id=doc_ref.id,
                name=name,
                description=description,
                owner_id=owner_id,
                invite_token=invite_token,
                created_at=group_data['created_at'],
                updated_at=group_data['updated_at'],
                members=[]
            )
            
        except Exception as e:
            print(f"Error creating group: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    @staticmethod
    def get_by_id(group_id: str) -> Optional['Group']:
        """Get group by ID"""
        try:
            db = get_db()
            doc_ref = db.collection(Collections.GROUPS).document(group_id)
            doc = doc_ref.get()
            
            if not doc.exists:
                return None
            
            data = doc.to_dict()
            return Group(
                group_id=doc.id,
                name=data['name'],
                description=data['description'],
                owner_id=data['owner_id'],
                invite_token=data['invite_token'],
                created_at=data['created_at'],
                updated_at=data.get('updated_at'),
                members=data.get('members', [])
            )
            
        except Exception as e:
            print(f"Error getting group by ID: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    @staticmethod
    def get_by_invite_token(invite_token: str) -> Optional['Group']:
        """Get group by invite token (for joining)"""
        try:
            db = get_db()
            groups_ref = db.collection(Collections.GROUPS)
            query = groups_ref.where('invite_token', '==', invite_token).limit(1).stream()
            
            for doc in query:
                data = doc.to_dict()
                return Group(
                    group_id=doc.id,
                    name=data['name'],
                    description=data['description'],
                    owner_id=data['owner_id'],
                    invite_token=data['invite_token'],
                    created_at=data['created_at'],
                    updated_at=data.get('updated_at'),
                    members=data.get('members', [])
                )
            
            return None
            
        except Exception as e:
            print(f"Error getting group by token: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    @staticmethod
    def get_user_groups(owner_id: str) -> List['Group']:
        """Get all groups owned by a user"""
        try:
            db = get_db()
            groups_ref = db.collection(Collections.GROUPS)
            query = groups_ref.where('owner_id', '==', owner_id).stream()
            
            groups = []
            for doc in query:
                data = doc.to_dict()
                groups.append(Group(
                    group_id=doc.id,
                    name=data['name'],
                    description=data['description'],
                    owner_id=data['owner_id'],
                    invite_token=data['invite_token'],
                    created_at=data['created_at'],
                    updated_at=data.get('updated_at'),
                    members=data.get('members', [])
                ))
            
            return groups
            
        except Exception as e:
            print(f"Error getting user groups: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    @staticmethod
    def validate_email(email: str) -> bool:
        """Validate email format using regex"""
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return re.match(pattern, email) is not None
    
    @staticmethod
    def parse_emails(text: str) -> List[str]:
        """Parse emails from text (separated by any whitespace)"""
        # Split by any whitespace (spaces, newlines, tabs, etc.)
        potential_emails = re.split(r'\s+', text.strip())
        
        # Filter to only valid email formats
        valid_emails = [email for email in potential_emails if Group.validate_email(email)]
        
        # Remove duplicates while preserving order
        seen = set()
        unique_emails = []
        for email in valid_emails:
            email_lower = email.lower()
            if email_lower not in seen:
                seen.add(email_lower)
                unique_emails.append(email)
        
        return unique_emails
    
    def add_members(self, emails: List[str]) -> int:
        """Add multiple members to the group. Returns count of added members."""
        try:
            db = get_db()
            group_ref = db.collection(Collections.GROUPS).document(self.id)
            
            # Get current members
            existing_emails = {member['email'].lower() for member in self.members}
            
            # Filter out duplicates
            new_members = []
            for email in emails:
                if email.lower() not in existing_emails:
                    new_members.append({
                        'email': email,
                        'status': 'active',
                        'added_at': datetime.utcnow().isoformat() + 'Z'
                    })
                    existing_emails.add(email.lower())
            
            if not new_members:
                print("No new members to add (all duplicates)")
                return 0
            
            # Update in database
            updated_members = self.members + new_members
            group_ref.update({
                'members': updated_members,
                'updated_at': datetime.utcnow().isoformat() + 'Z'
            })
            
            # Update local instance
            self.members = updated_members
            self.updated_at = datetime.utcnow().isoformat() + 'Z'
            
            print(f"✅ Added {len(new_members)} members to group {self.id}")
            return len(new_members)
            
        except Exception as e:
            print(f"Error adding members: {e}")
            import traceback
            traceback.print_exc()
            return 0
    
    def add_member(self, email: str) -> bool:
        """Add a single member to the group"""
        return self.add_members([email]) > 0
    
    def remove_member(self, email: str) -> bool:
        """Remove a member from the group by email"""
        try:
            db = get_db()
            group_ref = db.collection(Collections.GROUPS).document(self.id)
            
            # Filter out the member with matching email (case-insensitive)
            email_lower = email.lower()
            updated_members = [m for m in self.members if m['email'].lower() != email_lower]
            
            if len(updated_members) == len(self.members):
                print(f"Member {email} not found in group {self.id}")
                return False
            
            # Update in database
            group_ref.update({
                'members': updated_members,
                'updated_at': datetime.utcnow().isoformat() + 'Z'
            })
            
            # Update local instance
            self.members = updated_members
            self.updated_at = datetime.utcnow().isoformat() + 'Z'
            
            print(f"✅ Removed member {email} from group {self.id}")
            return True
            
        except Exception as e:
            print(f"Error removing member: {e}")
            import traceback
            traceback.print_exc()
            return False
