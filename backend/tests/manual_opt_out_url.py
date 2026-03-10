"""
Generate the opt-out (unsubscribe) URL for manual testing of Analytics.

Run from backend directory so .env and app are available:

  cd backend
  python tests/manual_opt_out_url.py <owner_id> <recipient_email>

Example (use your real owner_id from the app, e.g. after logging in as that user):

  python tests/manual_opt_out_url.py dUpjYti4gJMOtsYqtQDe 4adori@gmail.com

Then open the printed URL in a browser to opt out as that recipient.
After that, open the Analytics page in the app (logged in as the owner)
to confirm the opted_out event appears.
"""
import os
import sys

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(THIS_DIR, ".."))
APP_DIR = os.path.join(BACKEND_DIR, "app")
os.chdir(BACKEND_DIR)
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BACKEND_DIR, ".env"))
except ImportError:
    pass

from config import settings
from utils.email_service import EmailService


def main():
    if len(sys.argv) < 3:
        print("Usage: python tests/manual_opt_out_url.py <owner_id> <recipient_email>")
        print("  owner_id: The FormReminder user id (org owner) - find in app after login.")
        print("  recipient_email: Email of the person who will 'click' the opt-out link.")
        sys.exit(1)
    owner_id = sys.argv[1].strip()
    recipient_email = sys.argv[2].strip()
    if not owner_id or not recipient_email:
        print("Error: owner_id and recipient_email are required.")
        sys.exit(1)
    if not settings.SECRET_KEY or settings.SECRET_KEY == "change_me_in_production":
        print("Warning: SECRET_KEY not set or default; token may not match running app.")
    url = EmailService.build_unsubscribe_url(owner_id, recipient_email)
    print("Opt-out URL (open in browser to opt out as this recipient):")
    print(url)
    print()
    print("Then open Analytics in the app (logged in as the owner) to see the event.")


if __name__ == "__main__":
    main()
