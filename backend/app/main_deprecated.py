"""
DEPRECATED: This file is deprecated and will be removed in future versions.
IT DOES NOT USE FLASK
WE ARE USING FLASK, NOT FASTAPI
"""


from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.config import settings
from app.models.database import FirestoreDB
from app.routes import api


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    print(f"Starting {settings.APP_NAME}...")
    FirestoreDB.initialize()
    yield
    # Shutdown
    print(f"Shutting down {settings.APP_NAME}...")
    FirestoreDB.close()


# Initialize FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    description="Form Reminder System with Firestore",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(api.router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": f"Welcome to {settings.APP_NAME} API",
        "status": "running",
        "version": "1.0.0"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        db = FirestoreDB.get_db()
        return {
            "status": "healthy",
            "database": "connected" if db else "disconnected"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


