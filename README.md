FormReminder

"Set it and forget it!"

FormReminder is a web application designed to simplify and automate the process of collecting information from groups. It integrates with Google Forms to track submissions and automatically sends reminders to members who haven't responded yet.

Tech Stack

Frontend: React (Vite) + TypeScript

Backend: Python Flask

Database: Firebase Firestore

Hosting: Google Cloud Run (Future)

🛠 Prerequisites

Before starting, ensure you have the following installed on your machine:

Python 3.x

Node.js & npm

Google Cloud CLI

🚀 First-Time Setup Guide

Follow these steps exactly to go from a fresh clone to a working development environment.

1. Clone the Repository

git clone <your-repo-url>
cd FormReminder


2. Backend Setup

Set up the Python environment and install dependencies.

# Navigate to backend
cd backend

# Create a virtual environment
python -m venv venv

# Activate the virtual environment
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt


3. Frontend Setup

Install the Node.js libraries required for React.

# Open a new terminal or navigate back to root, then:
cd frontend

# Install dependencies
npm install


4. Google Cloud Authentication (Crucial)

Our app connects to a real Firestore database. To do this locally, you must authenticate your machine with Google.

Open your terminal (anywhere).

Run the login command:

gcloud auth application-default login


A browser window will open. Log in with the Google Account that has access to the Firebase project.

Once logged in, your local code can now magically talk to Firestore!

***(Note: If you get a "command not found" error, restart VS Code to refresh your system PATH).***

▶️ How to Run the App

To develop locally, you need two separate terminal instances running side-by-side.

Terminal 1: The Backend

This runs the Flask server on localhost:5000.

cd backend
# Make sure your venv is active! (You should see (venv) in your prompt)
# Windows: venv\Scripts\activate
# Mac: source venv/bin/activate

python app.py


Terminal 2: The Frontend

This runs the Vite development server on localhost:5173.

cd frontend
npm run dev


Access the App

Open your browser and go to: http://localhost:5173

📂 Project Structure

FormReminder/
├── backend/                # Flask Server
│   ├── app.py              # Main entry point & Routes
│   ├── venv/               # Python Virtual Environment (Ignored)
│   └── requirements.txt    # Python library list
├── frontend/               # React App
│   ├── src/                # Frontend source code
│   └── package.json        # Frontend library list
└── .gitignore              # Files to exclude from Git


❓ Troubleshooting

Q: "gcloud command not found"

Fix: You installed the Google Cloud SDK but didn't restart your editor. Close VS Code completely and reopen it.

Q: Backend says "Module not found: flask"

Fix: You probably forgot to activate your virtual environment. Run venv\Scripts\activate (Windows) or source venv/bin/activate (Mac) inside the backend folder.

Q: Frontend says "Network Error" when fetching data

Fix: Is your backend running? You