

# Author = Aidne Vangura
# Last edited 11/30/2025
"""This class should inherit from base settings. This is used for automatic loading of env variable loading  """

# import os
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    
    # Firebase Configuration
    FIREBASE_CREDENTIALS_PATH: Optional[str] = None  # this is used for finding the credential files
    FIREBASE_PROJECT_ID: Optional[str] = None  # this is the project identifier
    
    # Application Settings
    APP_NAME: str = "FormReminder"
    DEBUG: bool = True
    SECRET_KEY: str = "change_me_in_production"  # Flask session secret
    
    # Google OAuth Settings
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:5000/oauth/callback"
    
    # CORS Settings
    CORS_ORIGINS: list = ["http://localhost:5173", "http://localhost:3000"]
    
    class Config:
        env_file = ".env" # loads settings from an env file (temporary)
        case_sensitive = True # Makes sure the env variables are case-sensitive


settings = Settings() # Creates a global settings instance


