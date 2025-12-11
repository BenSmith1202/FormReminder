
# Author: "Aiden Vangura"
# Last edited 11/30/2025
"""This api.py file is used to test Firestore Database connection. Creates a testing doc for temporary use, it then reads the doc to verify proper connection. It then reads the test doc and deletes it and will return a success message or a 500 server error."""

from fastapi import APIRouter, HTTPException, status
from app.models.database import get_db, Collections
from datetime import datetime

router = APIRouter()


@router.get("/test")
async def test_firestore():
    # Tests connections
    try:
        db = get_db()
        
        # Try to write a test document
        test_ref = db.collection("_test").document("connection_test")
        test_ref.set({
            "message": "Firestore connection successful",
            "timestamp": datetime.utcnow()
        })
        
        # Read it back
        doc = test_ref.get()
        
        # Clean up
        test_ref.delete()
        
        return {
            "status": "success",
            "message": "Firestore connection is working!",
            "data": doc.to_dict()
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Firestore connection failed: {str(e)}"
        )


@router.get("/collections")
async def list_collections():
    """List all available collections"""
    return {
        "collections": [
            Collections.USERS,
            Collections.ORGANIZATIONS,
            Collections.TEAMS,
            Collections.GROUPS,
            Collections.FORMS,
            Collections.FORM_REQUESTS,
            Collections.RESPONSES,
            Collections.REMINDERS,
            Collections.ANALYTICS,
            Collections.NOTIFICATIONS,
            Collections.SETTINGS,
            Collections.AUDIT_LOGS
        ]
    }


